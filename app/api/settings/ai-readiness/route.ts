// GET /api/settings/ai-readiness
//
// Provider Readiness — an admin-only, read-only truth surface for AI
// provider configuration state. See lib/services/ai/providerReadiness.ts
// for the full contract and rationale.
//
// This route NEVER makes a live provider call and NEVER returns, logs, or
// serializes a credential value — only classifications, booleans, counts,
// and timestamps.

import { isAdminAuthorized } from "@/lib/auth";
import { getProviderReadiness } from "@/lib/services/ai/providerReadiness";

export async function GET() {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  try {
    const readiness = await getProviderReadiness();
    return Response.json(readiness);
  } catch (err) {
    console.error("[GET /api/settings/ai-readiness]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
