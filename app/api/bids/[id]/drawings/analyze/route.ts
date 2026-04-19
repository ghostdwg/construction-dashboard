import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

// POST /api/bids/[id]/drawings/analyze
// Body: { tier: 1|2|3, model: "haiku"|"sonnet"|"opus", uploadId?: number }
// Sends drawing PDF to the sidecar for Claude Vision analysis.
// Stores result on DrawingUpload and returns it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json() as { tier?: number; model?: string; uploadId?: number };
  const { tier, model, uploadId } = body;

  if (!tier || ![1, 2, 3].includes(tier))
    return Response.json({ error: "tier must be 1, 2, or 3" }, { status: 400 });
  if (!model || !["haiku", "sonnet", "opus"].includes(model))
    return Response.json({ error: "model must be haiku, sonnet, or opus" }, { status: 400 });

  const upload = uploadId
    ? await prisma.drawingUpload.findFirst({ where: { id: uploadId, bidId } })
    : await prisma.drawingUpload.findFirst({
        where: { bidId },
        orderBy: { uploadedAt: "desc" },
      });

  if (!upload)
    return Response.json({ error: "No drawing upload found for this bid" }, { status: 404 });

  await prisma.drawingUpload.update({
    where: { id: upload.id },
    data: { analysisStatus: "processing", analysisTier: tier, analysisModel: model },
  });

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const res = await fetch(`${SIDECAR_URL}/parse/drawings/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({ file_path: upload.filePath, tier, model }),
      signal: AbortSignal.timeout(600_000), // 10 min ceiling for full sets
    });

    if (!res.ok) {
      const err = await res.text();
      await prisma.drawingUpload.update({
        where: { id: upload.id },
        data: { analysisStatus: "error" },
      });
      return Response.json({ error: `Sidecar error: ${err}` }, { status: 502 });
    }

    const result = await res.json() as Record<string, unknown>;

    await prisma.drawingUpload.update({
      where: { id: upload.id },
      data: {
        analysisStatus: "ready",
        analysisJson: JSON.stringify(result),
        analysisGeneratedAt: new Date(),
      },
    });

    return Response.json(result);
  } catch (e) {
    await prisma.drawingUpload.update({
      where: { id: upload.id },
      data: { analysisStatus: "error" },
    });
    const raw = e instanceof Error ? e.message : "Analysis failed";
    const message = raw === "fetch failed"
      ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
      : raw;
    return Response.json({ error: message }, { status: 422 });
  }
}

// GET /api/bids/[id]/drawings/analyze
// Returns the most recent drawing upload's analysis result.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const upload = await prisma.drawingUpload.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      analysisStatus: true,
      analysisTier: true,
      analysisModel: true,
      analysisJson: true,
      analysisGeneratedAt: true,
    },
  });

  if (!upload) return Response.json(null);

  return Response.json({
    ...upload,
    analysisJson: upload.analysisJson ? JSON.parse(upload.analysisJson) : null,
  });
}
