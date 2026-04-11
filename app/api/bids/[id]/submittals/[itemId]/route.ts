// PATCH  /api/bids/[id]/submittals/[itemId]  → update one row
// DELETE /api/bids/[id]/submittals/[itemId]  → delete one row

import {
  updateSubmittal,
  deleteSubmittal,
  type SubmittalUpdateInput,
} from "@/lib/services/submittal/submittalService";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const submittalId = parseInt(itemId, 10);

  if (isNaN(bidId) || isNaN(submittalId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  let body: SubmittalUpdateInput;
  try {
    body = (await request.json()) as SubmittalUpdateInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await updateSubmittal(bidId, submittalId, body);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/bids/:id/submittals/:itemId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const submittalId = parseInt(itemId, 10);

  if (isNaN(bidId) || isNaN(submittalId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  try {
    const result = await deleteSubmittal(bidId, submittalId);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/bids/:id/submittals/:itemId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
