// POST /api/automation/brief-refresh
//
// Internal admin-only endpoint for automation to trigger a durable brief_refresh
// job without requiring an open browser tab.
//
// Unlike spec_analysis (which hands off to the sidecar), brief generation calls
// Claude directly — this request blocks until generation completes (~30–60s).
// Designed for overnight runners or batch scripts, not browser-facing flows.
//
// Guardrails enforced in triggerBriefRefresh():
//   - Bid must exist
//   - Skips if a queued or running brief_refresh job already exists for the bid
//
// Access: admin session OR AUTH_DISABLED=true (solo-dev bypass)
//
// Body:   { bidId: number }
// 200:    { status: "triggered", backgroundJobId, briefStatus }
// 200:    { status: "skipped", reason }
// 400/401/403/404/422: error response

import { isAdminAuthorized } from "@/lib/auth";
import {
  triggerBriefRefresh,
  TriggerError,
} from "@/lib/services/jobs/briefRefreshAutomation";

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
    const result = await triggerBriefRefresh(rawBidId, {
      triggerSource: "automation",
    });

    console.log(
      `[automation/brief-refresh] bid ${rawBidId}: ${result.status}` +
        (result.status === "skipped" ? ` — ${result.reason}` : "")
    );

    return Response.json(result);
  } catch (err) {
    if (err instanceof TriggerError) {
      return Response.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("[automation/brief-refresh] unexpected error:", err);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
