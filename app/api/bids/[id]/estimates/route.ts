import { prisma } from "@/lib/prisma";
import { saveEstimateFile, resolveFileType } from "@/lib/services/estimateStorage";
import { parseEstimateFile } from "@/lib/services/estimateParsers";
import { separateScopeAndPricing } from "@/lib/services/scopePricingSeparator";

// GET /api/bids/[id]/estimates
// Returns all EstimateUploads for the bid — never returns pricingData
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const uploads = await prisma.estimateUpload.findMany({
    where: { bidId },
    include: {
      subcontractor: { select: { id: true, company: true } },
    },
    orderBy: { uploadedAt: "desc" },
  });

  // Strip pricingData before returning
  const safe = uploads.map(({ pricingData: _p, ...rest }) => rest);
  return Response.json(safe);
}

// POST /api/bids/[id]/estimates
// Body: multipart form data with file + subcontractorId
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const subcontractorIdRaw = formData.get("subcontractorId");

  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  if (!subcontractorIdRaw) {
    return Response.json({ error: "subcontractorId is required" }, { status: 400 });
  }

  const subcontractorId = parseInt(String(subcontractorIdRaw), 10);
  if (isNaN(subcontractorId)) {
    return Response.json({ error: "subcontractorId must be a number" }, { status: 400 });
  }

  const fileType = resolveFileType(file.type, file.name);
  if (!fileType) {
    return Response.json(
      { error: "Unsupported file type. Upload PDF, XLSX, XLS, or DOCX." },
      { status: 400 }
    );
  }

  // Save file to disk
  let filePath: string;
  try {
    const saved = await saveEstimateFile(bidId, subcontractorId, file);
    filePath = saved.filePath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }

  // Upsert the EstimateUpload record as processing
  const upload = await prisma.estimateUpload.upsert({
    where: { bidId_subcontractorId: { bidId, subcontractorId } },
    create: {
      bidId,
      subcontractorId,
      fileName: file.name,
      fileType,
      fileSize: file.size,
      rawFilePath: filePath,
      parseStatus: "processing",
    },
    update: {
      fileName: file.name,
      fileType,
      fileSize: file.size,
      rawFilePath: filePath,
      parseStatus: "processing",
      parseError: null,
      scopeLines: "",
      pricingData: "",
    },
    include: { subcontractor: { select: { id: true, company: true } } },
  });

  // Parse and separate — update record when done
  try {
    const parsed = await parseEstimateFile(filePath, fileType);
    const { scopeLines, pricingData } = separateScopeAndPricing(
      parsed.rawText,
      parsed.rows
    );

    const updated = await prisma.estimateUpload.update({
      where: { id: upload.id },
      data: {
        scopeLines: JSON.stringify(scopeLines),
        pricingData: JSON.stringify(pricingData),
        parseStatus: "complete",
      },
      include: { subcontractor: { select: { id: true, company: true } } },
    });

    // Never return pricingData
    const { pricingData: _p, ...safe } = updated;
    return Response.json(safe, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/estimates] parse error:", err);

    await prisma.estimateUpload.update({
      where: { id: upload.id },
      data: { parseStatus: "failed", parseError: message },
    });

    const { pricingData: _p, ...safe } = upload;
    return Response.json(
      { ...safe, parseStatus: "failed", parseError: message },
      { status: 422 }
    );
  }
}
