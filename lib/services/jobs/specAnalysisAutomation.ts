// GWX-005 — Automation-safe spec analysis trigger
//
// Shared server-side logic for kicking off a durable spec_analysis job.
// Called from both the manual UI route and the internal automation endpoint.
//
// Guardrails enforced here:
//   1. Requires SpecBook with status "ready" and at least one section with pdfPath
//   2. Skips if a queued or running spec_analysis job already exists for the bid
//   3. Creates a durable BackgroundJob before touching the sidecar so we survive
//      a sidecar crash after submission
//   4. Completion is handled exclusively by the sidecar webhook — no browser needed

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createJob,
  startJob,
  failJob,
  findActiveJobForBid,
} from "./backgroundJobService";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";
const APP_URL = process.env.APP_URL || "http://127.0.0.1:3001";
const CALLBACK_TOKEN = process.env.SIDECAR_CALLBACK_TOKEN || "";

export type TriggerOutcome =
  | {
      status: "triggered";
      jobId: string;
      backgroundJobId: string;
      specBookId: number;
      inputSummary: string;
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

export async function triggerSpecAnalysis(
  bidId: number,
  opts?: { tier?: number; triggerSource?: "user" | "automation" }
): Promise<TriggerOutcome> {
  const tier = [1, 2, 3].includes(opts?.tier ?? 0) ? opts!.tier! : 2;
  const triggerSource = opts?.triggerSource ?? "user";

  // Skip if a job is already active — prevents duplicate overlapping runs
  const existing = await findActiveJobForBid(bidId, "spec_analysis");
  if (existing) {
    return {
      status: "skipped",
      reason: `spec_analysis job already ${existing.status} (${existing.id})`,
    };
  }

  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        where: { pdfPath: { not: null } },
        select: { id: true, csiNumber: true, csiTitle: true, pdfPath: true },
      },
    },
  });

  if (!specBook) {
    throw new TriggerError(
      404,
      "No spec book uploaded. Upload a spec book first."
    );
  }

  if (specBook.sections.length === 0) {
    throw new TriggerError(
      400,
      "No split sections found. Run 'Split into Sections' first."
    );
  }

  const inputSummary = `${specBook.sections.length} sections, tier ${tier}`;

  // Atomic duplicate guard: the unique index on (bidId, jobType, activeSlot)
  // enforces at-most-one active job at the DB level. The advisory check above
  // is the fast path for the common case; this catch handles the race where two
  // concurrent callers both passed the advisory check simultaneously.
  let dbJob: Awaited<ReturnType<typeof createJob>>;
  try {
    dbJob = await createJob({
      jobType: "spec_analysis",
      bidId,
      relatedId: String(specBook.id),
      inputSummary,
      triggerSource,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        status: "skipped" as const,
        reason:
          "concurrent trigger — active spec_analysis job already exists for this bid",
      };
    }
    throw err;
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const sectionsPayload = specBook.sections.map((s) => ({
      csi: s.csiNumber,
      title: s.csiTitle,
      pdf_path: s.pdfPath,
    }));

    const res = await fetch(`${SIDECAR_URL}/parse/specs/analyze_split`, {
      method: "POST",
      body: JSON.stringify({
        sections: sectionsPayload,
        tier,
        callback_url: `${APP_URL}/api/bids/${bidId}/specbook/analyze/complete`,
        callback_token: CALLBACK_TOKEN || undefined,
      }),
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ detail: `Sidecar returned ${res.status}` }));
      await failJob(dbJob.id, err.detail ?? `Sidecar returned ${res.status}`);
      throw new TriggerError(
        res.status,
        err.detail ?? "Failed to start analysis"
      );
    }

    const { job_id } = (await res.json()) as { job_id: string };
    await startJob(dbJob.id, job_id);

    console.log(
      `[triggerSpecAnalysis] submitted job ${job_id} (db: ${dbJob.id}) ` +
        `for bid ${bidId} via ${triggerSource}`
    );

    return {
      status: "triggered",
      jobId: job_id,
      backgroundJobId: dbJob.id,
      specBookId: specBook.id,
      inputSummary,
    };
  } catch (err) {
    if (err instanceof TriggerError) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    const message =
      raw === "fetch failed"
        ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
        : raw;
    await failJob(dbJob.id, message).catch(() => {});
    throw new TriggerError(422, message);
  }
}
