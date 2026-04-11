// PATCH  /api/bids/[id]/contacts/[contactId] — update one project contact
// DELETE /api/bids/[id]/contacts/[contactId] — delete one project contact
//
// Module H1 — Project Contacts.

import {
  updateProjectContact,
  deleteProjectContact,
  type ProjectContactInput,
} from "@/lib/services/contacts/projectContactService";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const bidId = parseInt(id, 10);
  const cId = parseInt(contactId, 10);
  if (isNaN(bidId) || isNaN(cId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  let body: ProjectContactInput;
  try {
    body = (await request.json()) as ProjectContactInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await updateProjectContact(bidId, cId, body);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ row: result.row });
  } catch (err) {
    console.error("[PATCH /api/bids/:id/contacts/:contactId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const bidId = parseInt(id, 10);
  const cId = parseInt(contactId, 10);
  if (isNaN(bidId) || isNaN(cId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  try {
    const result = await deleteProjectContact(bidId, cId);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/bids/:id/contacts/:contactId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
