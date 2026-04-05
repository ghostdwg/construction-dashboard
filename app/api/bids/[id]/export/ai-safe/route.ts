import { prisma } from "@/lib/prisma";
import { buildAiSafePayload } from "@/lib/exports/aiSafeExport";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || body.approved !== true) {
    return Response.json(
      { error: "Body must include { approved: true }" },
      { status: 400 }
    );
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { projectName: true },
  });
  if (!bid) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  const { payload, restrictedCount } = await buildAiSafePayload(bidId);

  await prisma.aiExportBatch.create({
    data: {
      bidId,
      restrictedCount,
      status: "complete",
    },
  });

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const safeName = bid.projectName.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const filename = `${safeName}_ai_safe_${date}.json`;

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
