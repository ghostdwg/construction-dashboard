const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;
  try {
    const r = await fetch(`${SIDECAR_URL}/ollama/health`, {
      headers, cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return Response.json(await r.json(), { status: r.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ reachable: false, error: msg }, { status: 502 });
  }
}
