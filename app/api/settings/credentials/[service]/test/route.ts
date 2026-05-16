/**
 * POST /api/settings/credentials/[service]/test
 *
 * Triggers a sidecar test-connection attempt. The Next.js process does NOT
 * decrypt — it asks the sidecar (which holds the master key separately) to
 * perform the test using its own decryption. Returns success/fail with a
 * short error string for UI display. No raw credential material is ever
 * returned through this route.
 */

import { auth } from "@/lib/auth";
import {
  isValidService,
  recordTestResult,
} from "@/lib/services/credentials/credentialsService";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") return Response.json({ error: "admin required" }, { status: 403 });

  const { service } = await params;
  if (!isValidService(service)) {
    return Response.json({ error: `Invalid service: ${service}` }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}/credentials/test/${encodeURIComponent(service)}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordTestResult({ service, status: "failed", error: `Sidecar unreachable: ${msg}` });
    return Response.json({ status: "failed", error: `Sidecar unreachable: ${msg}` }, { status: 502 });
  }

  const result = await res.json().catch(() => ({}));
  const status = res.ok && result?.ok ? "success" : "failed";
  const error  = result?.error ?? (res.ok ? null : `HTTP ${res.status}`);

  await recordTestResult({ service, status, error: error ?? undefined });

  return Response.json({
    service,
    status,
    error: status === "failed" ? error : null,
    testedAt: new Date().toISOString(),
  });
}
