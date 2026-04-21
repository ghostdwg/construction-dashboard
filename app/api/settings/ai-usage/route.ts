// GET /api/settings/ai-usage
//
// Returns AI usage summaries for today / 7 days / 30 days. Powers the
// Usage subsection on the AI Settings card.

import { isAdminAuthorized } from "@/lib/auth";
import { loadUsageSummaries } from "@/lib/services/ai/aiUsageLog";

export async function GET() {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }
  try {
    const summaries = await loadUsageSummaries();
    return Response.json(summaries);
  } catch (err) {
    console.error("[GET /api/settings/ai-usage]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
