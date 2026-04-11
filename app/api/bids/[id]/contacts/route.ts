// GET  /api/bids/[id]/contacts — list project contacts
// POST /api/bids/[id]/contacts — create one
//
// Module H1 — Project Contacts. Backs the ProjectContactsPanel on the Overview
// and Handoff tabs and feeds the H1 handoff packet's Contacts sheet.

import {
  loadProjectContactsForBid,
  createProjectContact,
  type ProjectContactInput,
} from "@/lib/services/contacts/projectContactService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const items = await loadProjectContactsForBid(bidId);
    return Response.json({ items });
  } catch (err) {
    console.error("[GET /api/bids/:id/contacts]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: ProjectContactInput;
  try {
    body = (await request.json()) as ProjectContactInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await createProjectContact(bidId, body);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ row: result.row }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/bids/:id/contacts]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
