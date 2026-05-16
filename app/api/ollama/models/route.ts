const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch(`${SIDECAR_URL}/ollama/models`, {
      headers: sidecarHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      return Response.json({ error: `sidecar HTTP ${r.status}` }, { status: 502 });
    }
    return Response.json(await r.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
