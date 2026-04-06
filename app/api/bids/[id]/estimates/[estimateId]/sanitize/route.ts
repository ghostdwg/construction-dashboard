import { prisma } from "@/lib/prisma";
import { redactEstimate, TOKEN_LABELS } from "@/lib/services/redaction/redactEstimate";

// PATCH /api/bids/[id]/estimates/[estimateId]/sanitize
// Body: { action: "approve" | "unapprove" | "redact_line", line?: string }
// approve/unapprove — sets approvedForAi
// redact_line — removes a specific line from sanitizedText and flaggedLines,
//               marks it redacted, decrements nothing (line is simply removed)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; estimateId: string }> }
) {
  const { id, estimateId } = await params;
  const bidId = parseInt(id, 10);
  const uploadId = parseInt(estimateId, 10);
  if (isNaN(bidId) || isNaN(uploadId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const upload = await prisma.estimateUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      bidId: true,
      sanitizedText: true,
      flaggedLines: true,
      sanitizationStatus: true,
    },
  });
  if (!upload || upload.bidId !== bidId) {
    return Response.json({ error: "Estimate not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action as string | undefined;

  if (action === "approve") {
    await prisma.estimateUpload.update({
      where: { id: uploadId },
      data: { approvedForAi: true, sanitizationStatus: "complete" },
    });
    return Response.json({ id: uploadId, approvedForAi: true });
  }

  if (action === "unapprove") {
    await prisma.estimateUpload.update({
      where: { id: uploadId },
      data: { approvedForAi: false },
    });
    return Response.json({ id: uploadId, approvedForAi: false });
  }

  if (action === "redact_line") {
    const lineToRedact = body?.line as string | undefined;
    if (!lineToRedact) {
      return Response.json({ error: "line is required for redact_line" }, { status: 400 });
    }

    // Remove the line from sanitizedText entirely
    const lines = (upload.sanitizedText ?? "").split("\n");
    const filtered = lines.filter((l) => l.trim() !== lineToRedact.trim());
    const newSanitizedText = filtered.join("\n").trim();

    // Remove from flaggedLines
    const flagged: string[] = upload.flaggedLines ? JSON.parse(upload.flaggedLines) : [];
    const newFlagged = flagged.filter((l) => l.trim() !== lineToRedact.trim());
    const newStatus = newFlagged.length > 0 ? "needs_review" : "complete";

    await prisma.estimateUpload.update({
      where: { id: uploadId },
      data: {
        sanitizedText: newSanitizedText,
        flaggedLines: JSON.stringify(newFlagged),
        sanitizationStatus: newStatus,
        approvedForAi: false,
      },
    });

    return Response.json({
      id: uploadId,
      sanitizationStatus: newStatus,
      flaggedLineCount: newFlagged.length,
      flaggedLines: newFlagged,
    });
  }

  if (action === "confirm_line") {
    // Line reviewed and confirmed safe — remove from flaggedLines, keep in sanitizedText
    const lineToConfirm = body?.line as string | undefined;
    if (!lineToConfirm) {
      return Response.json({ error: "line is required for confirm_line" }, { status: 400 });
    }

    const flagged: string[] = upload.flaggedLines ? JSON.parse(upload.flaggedLines) : [];
    const newFlagged = flagged.filter((l) => l.trim() !== lineToConfirm.trim());
    const newStatus = newFlagged.length > 0 ? "needs_review" : "complete";

    await prisma.estimateUpload.update({
      where: { id: uploadId },
      data: {
        flaggedLines: JSON.stringify(newFlagged),
        sanitizationStatus: newStatus,
      },
    });

    return Response.json({
      id: uploadId,
      sanitizationStatus: newStatus,
      flaggedLineCount: newFlagged.length,
      flaggedLines: newFlagged,
    });
  }

  return Response.json(
    { error: "action must be approve, unapprove, redact_line, or confirm_line" },
    { status: 400 }
  );
}

// POST /api/bids/[id]/estimates/[estimateId]/sanitize
// Runs the redaction engine on an estimate's scopeLines.
// Assigns a stable per-bid subToken (SUB-A, SUB-B, …) if not already set.
// Stores sanitizedText, sanitizationStatus, redactionCount, flaggedLines.
// Sets sanitizationStatus:
//   "complete"     — no flagged lines
//   "needs_review" — flagged lines present
//   "error"        — scopeLines missing or parse failed
// Never touches pricingData. Never returns pricingData.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; estimateId: string }> }
) {
  const { id, estimateId } = await params;
  const bidId = parseInt(id, 10);
  const uploadId = parseInt(estimateId, 10);
  if (isNaN(bidId) || isNaN(uploadId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const upload = await prisma.estimateUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      bidId: true,
      scopeLines: true,
      parseStatus: true,
      subToken: true,
      pricingData: false, // explicit exclusion for clarity
    },
  });

  if (!upload || upload.bidId !== bidId) {
    return Response.json({ error: "Estimate not found" }, { status: 404 });
  }

  if (upload.parseStatus !== "complete") {
    return Response.json(
      { error: "Estimate parse not complete — run sanitization after parsing" },
      { status: 409 }
    );
  }

  if (!upload.scopeLines || upload.scopeLines === "[]" || upload.scopeLines === "") {
    await prisma.estimateUpload.update({
      where: { id: uploadId },
      data: { sanitizationStatus: "error" },
    });
    return Response.json({ error: "No scope lines to sanitize" }, { status: 422 });
  }

  // Assign subToken if not already set. Count existing tokens for this bid.
  let subToken = upload.subToken;
  if (!subToken) {
    const existing = await prisma.estimateUpload.findMany({
      where: { bidId, subToken: { not: null } },
      select: { subToken: true },
      orderBy: { uploadedAt: "asc" },
    });
    const usedTokens = new Set(existing.map((e) => e.subToken));
    subToken = TOKEN_LABELS.find((t) => !usedTokens.has(t)) ?? `SUB-${uploadId}`;
  }

  // Run redaction
  let result;
  try {
    result = redactEstimate(upload.scopeLines);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.estimateUpload.update({
      where: { id: uploadId },
      data: { sanitizationStatus: "error", subToken },
    });
    return Response.json({ error: message }, { status: 500 });
  }

  const { sanitizedText, flaggedLines, redactionCount } = result;
  const sanitizationStatus = flaggedLines.length > 0 ? "needs_review" : "complete";

  await prisma.estimateUpload.update({
    where: { id: uploadId },
    data: {
      subToken,
      sanitizedText,
      sanitizationStatus,
      redactionCount,
      flaggedLines: JSON.stringify(flaggedLines),
      // Reset approval if re-sanitizing — estimator must re-approve
      approvedForAi: false,
    },
  });

  return Response.json({
    id: uploadId,
    subToken,
    sanitizationStatus,
    redactionCount,
    flaggedLineCount: flaggedLines.length,
    flaggedLines,
    sanitizedText,
  });
}
