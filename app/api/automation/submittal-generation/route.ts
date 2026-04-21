// POST /api/automation/submittal-generation
//
// Internal admin-only endpoint for automation to trigger a durable
// submittal_generation job without requiring an open browser tab.
//
// Covers Phase 1 only (spec-based generation from analyzed SpecSections).
// Phase 2 (drawing cross-reference) requires the sidecar and browser polling.
//
// Guardrails enforced in triggerSubmittalGeneration():
//   - SpecBook with status "ready" must exist for the bid
//   - At least one SpecSection must have aiExtractions (spec analysis must have run)
//   - Skips if a queued or running submittal_generation job already exists
//
// Access: admin session OR AUTH_DISABLED=true (solo-dev bypass)
//
// Body:   { bidId: number }
// 200:    { status: "triggered", backgroundJobId, result: GenerateResult }
// 200:    { status: "skipped", reason }
// 400/401/403/404/422: error response

import { isAdminAuthorized } from "@/lib/auth";
import {
  triggerSubmittalGeneration,
  TriggerError,
} from "@/lib/services/jobs/submittalGenerationAutomation";

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

  try {
    const result = await triggerSubmittalGeneration(rawBidId, {
      triggerSource: "automation",
    });

    console.log(
      `[automation/submittal-generation] bid ${rawBidId}: ${result.status}` +
        (result.status === "skipped" ? ` — ${result.reason}` : "")
    );

    return Response.json(result);
  } catch (err) {
    if (err instanceof TriggerError) {
      return Response.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("[automation/submittal-generation] unexpected error:", err);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
