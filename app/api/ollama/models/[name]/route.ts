const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!name) return Response.json({ error: "model name required" }, { status: 400 });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;
  try {
    const r = await fetch(`${SIDECAR_URL}/ollama/models/${encodeURIComponent(name)}`, {
      method: "DELETE", headers,
      signal: AbortSignal.timeout(30_000),
    });
    return Response.json(await r.json(), { status: r.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
