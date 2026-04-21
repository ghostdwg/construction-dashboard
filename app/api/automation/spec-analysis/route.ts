// POST /api/automation/spec-analysis
//
// Internal admin-only endpoint for automation to trigger a durable spec_analysis
// job without requiring an open browser tab.
//
// Designed for overnight runners, batch scripts, or future schedulers.
// The completion path is the existing sidecar webhook at
// POST /api/bids/[id]/specbook/analyze/complete — unchanged.
//
// Guardrails enforced in triggerSpecAnalysis():
//   - Bid must have a SpecBook with status "ready" and split sections with pdfPaths
//   - Skips if a queued or running spec_analysis job already exists for the bid
//
// Access: admin session OR AUTH_DISABLED=true (solo-dev bypass)
//
// Body:   { bidId: number, tier?: 1 | 2 | 3 }
// 200:    { status: "triggered", jobId, backgroundJobId, specBookId, inputSummary }
// 200:    { status: "skipped", reason }
// 400/401/403/404/422: error response

import { isAdminAuthorized } from "@/lib/auth";
import {
  triggerSpecAnalysis,
  TriggerError,
} from "@/lib/services/jobs/specAnalysisAutomation";

export async function POST(request: Request) {
  const authResult = await isAdminAuthorized();
  if (!authResult.authorized) {
    return Response.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    bidId?: unknown;
    tier?: unknown;
  };

  const rawBidId =
    typeof body.bidId === "number"
      ? body.bidId
      : parseInt(String(body.bidId ?? ""), 10);
  if (!rawBidId || isNaN(rawBidId)) {
    return Response.json(
      { error: "bidId (number) is required" },
      { status: 400 }
    );
  }

  const tier = [1, 2, 3].includes(body.tier as number)
    ? (body.tier as 1 | 2 | 3)
    : 2;

  try {
    const result = await triggerSpecAnalysis(rawBidId, {
      tier,
      triggerSource: "automation",
    });

    console.log(
      `[automation/spec-analysis] bid ${rawBidId}: ${result.status}` +
        (result.status === "skipped" ? ` — ${result.reason}` : "")
    );

    return Response.json(result);
  } catch (err) {
    if (err instanceof TriggerError) {
      return Response.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("[automation/spec-analysis] unexpected error:", err);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
