// GET /metrics — Prometheus scrape endpoint (Phase O1.2)
//
// Exposes Prometheus text-format 0.0.4. Bound to authenticated /metrics access
// is normally desirable, but in a single-host Docker deployment this endpoint
// is only reachable from inside the compose network (Prometheus is the only
// caller). For multi-host / multi-tenant operation, route this behind an
// internal-only network or add a shared-token check.
//
// Cache-Control: no-store — metrics are point-in-time scrapes.

import { renderPrometheus } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const body = renderPrometheus();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
