// GWX-AUTO-001 — Automation-safe brief refresh trigger
//
// Shared server-side logic for kicking off a durable brief_refresh job.
// Unlike spec_analysis (sidecar-async), brief generation calls Claude
// directly — the job runs inline and completes synchronously within
// the triggering request.
//
// Guardrails enforced here:
//   1. Bid must exist
//   2. Skips if a queued or running brief_refresh job already exists for the bid
//   3. Creates a durable BackgroundJob before touching the AI call so status is
//      visible in the morning review panel from the moment it starts
//   4. completeJob / failJob are called before this function returns

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createJob,
  startJob,
  completeJob,
  failJob,
  findActiveJobForBid,
} from "./backgroundJobService";
import { generateBidIntelligenceBrief } from "@/lib/services/ai/generateBidIntelligenceBrief";

export type TriggerOutcome =
  | {
      status: "triggered";
      backgroundJobId: string;
      briefStatus: string;
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

export async function triggerBriefRefresh(
  bidId: number,
  opts?: { triggerSource?: "user" | "automation" | "upload" }
): Promise<TriggerOutcome> {
  const triggerSource = opts?.triggerSource ?? "user";

  // Fast advisory check — catches the common case without touching the DB lock
  const existing = await findActiveJobForBid(bidId, "brief_refresh");
  if (existing) {
    return {
      status: "skipped",
      reason: `brief_refresh job already ${existing.status} (${existing.id})`,
    };
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true },
  });
  if (!bid) {
    throw new TriggerError(404, `Bid ${bidId} not found`);
  }

  // Atomic duplicate guard: the unique index on (bidId, jobType, activeSlot)
  // catches the race where two concurrent callers both passed the advisory check.
  let dbJob: Awaited<ReturnType<typeof createJob>>;
  try {
    dbJob = await createJob({
      jobType: "brief_refresh",
      bidId,
      inputSummary: `brief refresh, ${triggerSource}`,
      triggerSource,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        status: "skipped",
        reason: "concurrent trigger — active brief_refresh job already exists for this bid",
      };
    }
    throw err;
  }

  // Mark running immediately — no sidecar, generation runs in this process
  await startJob(dbJob.id);

  console.log(
    `[triggerBriefRefresh] started job ${dbJob.id} for bid ${bidId} via ${triggerSource}`
  );

  try {
    const result = await generateBidIntelligenceBrief(bidId, triggerSource);

    const resultSummary = result.sourceContext
      ? [
          `${result.sourceContext.specSectionCount} sections`,
          result.sourceContext.addendumCount > 0
            ? `${result.sourceContext.addendumCount} addendum${result.sourceContext.addendumCount === 1 ? "" : "a"}`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : "brief refreshed";

    await completeJob(dbJob.id, {
      resultSummary,
      artifactType: "bid_brief",
    });

    console.log(
      `[triggerBriefRefresh] completed job ${dbJob.id} for bid ${bidId} — ${resultSummary}`
    );

    return {
      status: "triggered",
      backgroundJobId: dbJob.id,
      briefStatus: result.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(dbJob.id, message).catch(() => {});
    throw new TriggerError(422, message);
  }
}
