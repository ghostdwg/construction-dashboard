const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export const maxDuration = 1800;

export async function POST(request: Request) {
  const body = await request.json();
  const model: unknown = body?.model;
  if (typeof model !== "string" || !model.trim()) {
    return Response.json({ error: "model is required" }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  let upstream: Response;
  try {
    upstream = await fetch(`${SIDECAR_URL}/ollama/pull`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: model.trim() }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Sidecar unreachable: ${msg}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json({ error: `Sidecar HTTP ${upstream.status} ${detail.slice(0, 300)}` }, { status: 502 });
  }

  // Pass the NDJSON stream straight through to the browser
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
