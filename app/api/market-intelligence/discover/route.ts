const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export const maxDuration = 600; // 10 min — large-radius discovery crawls many sites + Playwright fallback for JS-rendered pages

export async function POST(request: Request) {
  const body = await request.json();

  const center: string | undefined = body.center?.trim() || undefined;
  const lat: number | undefined    = typeof body.lat === "number" ? body.lat : undefined;
  const lon: number | undefined    = typeof body.lon === "number" ? body.lon : undefined;
  const radius                     = Number(body.radius_miles ?? body.radiusMiles ?? 20);
  const stateFilter: string | undefined = body.state_filter || body.stateFilter || undefined;

  if (!center && (lat === undefined || lon === undefined)) {
    return Response.json({ error: "Provide center (string) or lat+lon" }, { status: 400 });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100) {
    return Response.json({ error: "radius_miles must be 1-100" }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}/market/discover-sources`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        center, lat, lon,
        radius_miles: radius,
        state_filter: stateFilter,
      }),
      signal: AbortSignal.timeout(580_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Sidecar unreachable: ${msg}` }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `Sidecar discovery failed: HTTP ${res.status} ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }

  return Response.json(await res.json());
}
