import { prisma } from "@/lib/prisma";
import { readStoragePathBuffer } from "@/lib/services/specbook/storagePath";

// GET /api/bids/[id]/specbook/sections/[sectionId]/pdf
//
// Streams the per-section PDF so it can be viewed in-browser or downloaded.
// The PDF was created by the splitter and lives in BlobStore under
// plan-room/jobs/{bidId}/spec/sections/.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id, sectionId } = await params;
  const bidId = parseInt(id, 10);
  const secId = parseInt(sectionId, 10);
  if (isNaN(bidId) || isNaN(secId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const section = await prisma.specSection.findUnique({
    where: { id: secId },
    include: { specBook: { select: { bidId: true } } },
  });

  if (!section || section.specBook.bidId !== bidId) {
    return Response.json({ error: "Section not found" }, { status: 404 });
  }

  if (!section.pdfPath) {
    return Response.json(
      { error: "PDF not available — run Split first" },
      { status: 404 }
    );
  }

  try {
    const buffer = await readStoragePathBuffer(section.pdfPath, bidId);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${section.pdfFileName ?? "section.pdf"}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "PDF file missing on disk" }, { status: 404 });
  }
}
