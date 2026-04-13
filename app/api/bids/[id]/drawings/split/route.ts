// POST /api/bids/[id]/drawings/split
// Proxies the uploaded PDF to the sidecar /parse/drawings/split endpoint
// for discipline detection. Returns the split analysis for user confirmation.

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  try {
    // Forward to sidecar
    const sidecarForm = new FormData();
    sidecarForm.append("file", file);

    const headers: Record<string, string> = {};
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const res = await fetch(`${SIDECAR_URL}/parse/drawings/split`, {
      method: "POST",
      body: sidecarForm,
      headers,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar returned ${res.status}` }));
      return Response.json(
        { error: err.detail ?? "Split analysis failed" },
        { status: res.status }
      );
    }

    const result = await res.json();
    return Response.json(result);
  } catch (err) {
    console.error("[drawings/split] sidecar error:", err);
    return Response.json(
      { error: "Drawing analysis service unavailable" },
      { status: 503 }
    );
  }
}
