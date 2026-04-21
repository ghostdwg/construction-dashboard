// GWX-AUTO-002 — Automation-safe submittal generation trigger
//
// Shared server-side logic for kicking off a durable submittal_generation job.
// Covers Phase 1 only (spec-based generation via generateSubmittalsFromAiAnalysis).
// Phase 2 (drawing cross-reference) requires the sidecar and browser-side polling —
// it is not included here.
//
// Guardrails enforced here:
//   1. SpecBook with status "ready" must exist for the bid
//   2. At least one SpecSection must have aiExtractions populated (spec analysis must have run)
//   3. Skips if a queued or running submittal_generation job already exists for the bid
//   4. Creates a durable BackgroundJob before generation begins
//   5. completeJob / failJob are called before this function returns

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createJob,
  startJob,
  completeJob,
  failJob,
  findActiveJobForBid,
} from "./backgroundJobService";
import { generateSubmittalsFromAiAnalysis } from "@/lib/services/submittal/generateFromAiAnalysis";

export type TriggerOutcome =
  | {
      status: "triggered";
      backgroundJobId: string;
      result: Awaited<ReturnType<typeof generateSubmittalsFromAiAnalysis>>;
    }
  | { status: "skipped"; reason: string };

export class TriggerError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string
  ) {
    super(message);
    this.name = "TriggerError";
  }
}

export async function triggerSubmittalGeneration(
  bidId: number,
  opts?: { triggerSource?: "user" | "automation" }
): Promise<TriggerOutcome> {
  const triggerSource = opts?.triggerSource ?? "user";

  // Fast advisory check — catches the common case without touching the DB lock
  const existing = await findActiveJobForBid(bidId, "submittal_generation");
  if (existing) {
    return {
      status: "skipped",
      reason: `submittal_generation job already ${existing.status} (${existing.id})`,
    };
  }

  // Prerequisite 1: spec book must exist and be ready
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      sections: {
        where: { aiExtractions: { not: null } },
        select: { id: true },
      },
    },
  });

  if (!specBook) {
    throw new TriggerError(
      404,
      "No spec book found for this bid. Upload and process a spec book first."
    );
  }

  // Prerequisite 2: spec analysis must have run (at least one section analyzed)
  const analyzedCount = specBook.sections.length;
  if (analyzedCount === 0) {
    throw new TriggerError(
      400,
      "No analyzed spec sections found. Run spec analysis first."
    );
  }

  // Atomic duplicate guard: the unique index on (bidId, jobType, activeSlot)
  // catches the race where two concurrent callers both passed the advisory check.
  let dbJob: Awaited<ReturnType<typeof createJob>>;
  try {
    dbJob = await createJob({
      jobType: "submittal_generation",
      bidId,
      relatedId: String(specBook.id),
      inputSummary: `${analyzedCount} analyzed section${analyzedCount === 1 ? "" : "s"}, ${triggerSource}`,
      triggerSource,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        status: "skipped",
        reason: "concurrent trigger — active submittal_generation job already exists for this bid",
      };
    }
    throw err;
  }

  await startJob(dbJob.id);

  console.log(
    `[triggerSubmittalGeneration] started job ${dbJob.id} for bid ${bidId} via ${triggerSource}`
  );

  try {
    const result = await generateSubmittalsFromAiAnalysis(bidId, {
      sourceJobId: dbJob.id,
    });

    const resultSummary = `${result.created} submittal${result.created === 1 ? "" : "s"} created from ${result.sectionsWithExtractions} section${result.sectionsWithExtractions === 1 ? "" : "s"}`;

    await completeJob(dbJob.id, {
      resultSummary,
      artifactType: "submittal_register",
    });

    console.log(
      `[triggerSubmittalGeneration] completed job ${dbJob.id} for bid ${bidId} — ${resultSummary}`
    );

    return {
      status: "triggered",
      backgroundJobId: dbJob.id,
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(dbJob.id, message).catch(() => {});
    throw new TriggerError(422, message);
  }
}
