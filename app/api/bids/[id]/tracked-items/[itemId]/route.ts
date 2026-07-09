// Module OPS1 (Slice 1) — single tracked-item routes.
//
// GET   /api/bids/[id]/tracked-items/[itemId]   — detail incl. comments + attachment metadata
// PATCH /api/bids/[id]/tracked-items/[itemId]   — update non-status fields
//        Body: { title?, description?, priority?, assigneeName?,
//                assigneeEmail?, dueDate? }  (status changes go through
//                the /status route and the FSM — never through PATCH)

import { getTrackedItem, updateTrackedItem } from "@/lib/services/trackedItems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const item = await getTrackedItem(bidId, tid);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    id: item.id,
    kind: item.kind,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    assigneeName: item.assigneeName,
    assigneeEmail: item.assigneeEmail,
    dueDate: item.dueDate?.toISOString() ?? null,
    carriedFromDate: item.carriedFromDate,
    sourceKind: item.sourceKind,
    sourceMeetingId: item.sourceMeetingId,
    sourceMeetingActionItemId: item.sourceMeetingActionItemId,
    sourceSpecSectionId: item.sourceSpecSectionId,
    evidenceExcerpt: item.evidenceExcerpt,
    sourceLocator: item.sourceLocator,
    extractionMethod: item.extractionMethod,
    extractorVersion: item.extractorVersion,
    citationVerified: item.citationVerified,
    closedAt: item.closedAt?.toISOString() ?? null,
    closedBy: item.closedBy,
    waivedReason: item.waivedReason,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    comments: item.comments.map((c) => ({
      id: c.id,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    attachments: item.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
      kind: a.kind,
      caption: a.caption,
      createdBy: a.createdBy,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if ("status" in body) {
    return Response.json(
      { error: "Status changes must go through POST .../status (FSM-validated)" },
      { status: 400 }
    );
  }

  let dueDate: Date | null | undefined = undefined;
  if ("dueDate" in body) {
    if (body.dueDate === null) dueDate = null;
    else if (typeof body.dueDate === "string") {
      dueDate = new Date(body.dueDate);
      if (isNaN(dueDate.getTime()))
        return Response.json({ error: "Invalid dueDate" }, { status: 400 });
    } else {
      return Response.json({ error: "Invalid dueDate" }, { status: 400 });
    }
  }

  const result = await updateTrackedItem(bidId, tid, {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...("description" in body
      ? { description: typeof body.description === "string" ? body.description : null }
      : {}),
    ...(typeof body.priority === "string" ? { priority: body.priority } : {}),
    ...("assigneeName" in body
      ? { assigneeName: typeof body.assigneeName === "string" ? body.assigneeName : null }
      : {}),
    ...("assigneeEmail" in body
      ? { assigneeEmail: typeof body.assigneeEmail === "string" ? body.assigneeEmail : null }
      : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
  });

  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
