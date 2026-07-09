// Module OPS1 (Slice 1) — tracked-item register collection routes.
//
// GET  /api/bids/[id]/tracked-items?kind=&status=&assignee=
//   List the bid's tracked items (all kinds — OAC/field/JSO/warranty/
//   closeout/training/O&M/testing/attic-stock share this ONE register).
//
// POST /api/bids/[id]/tracked-items
//   Manually create an item. Body: { kind, title, description?, priority?,
//   assigneeName?, assigneeEmail?, dueDate?, evidenceExcerpt?, sourceLocator? }
//
// Auth: session wall via proxy.ts (same convention as every bid route);
// tenancy via bidId-scoped queries. No provider, Procore, or email path
// exists anywhere below this route.

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createTrackedItem, listTrackedItems } from "@/lib/services/trackedItems";

async function sessionActor() {
  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;
  return { name: user?.name ?? null, email: user?.email ?? null };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const items = await listTrackedItems(bidId, {
    kind: searchParams.get("kind") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    assigneeName: searchParams.get("assignee") ?? undefined,
  });

  return Response.json({
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      description: i.description,
      status: i.status,
      priority: i.priority,
      assigneeName: i.assigneeName,
      dueDate: i.dueDate?.toISOString() ?? null,
      sourceKind: i.sourceKind,
      sourceMeetingId: i.sourceMeetingId,
      sourceMeetingActionItemId: i.sourceMeetingActionItemId,
      sourceSpecSectionId: i.sourceSpecSectionId,
      sourceFieldReportId: i.sourceFieldReportId,
      evidenceExcerpt: i.evidenceExcerpt,
      sourceLocator: i.sourceLocator,
      extractionMethod: i.extractionMethod,
      citationVerified: i.citationVerified,
      carriedFromDate: i.carriedFromDate,
      closedAt: i.closedAt?.toISOString() ?? null,
      closedBy: i.closedBy,
      waivedReason: i.waivedReason,
      commentCount: i._count.comments,
      attachmentCount: i._count.attachments,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dueDateRaw = typeof body.dueDate === "string" ? new Date(body.dueDate) : null;
  if (dueDateRaw && isNaN(dueDateRaw.getTime())) {
    return Response.json({ error: "Invalid dueDate" }, { status: 400 });
  }

  const result = await createTrackedItem(
    bidId,
    {
      kind: String(body.kind ?? ""),
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : null,
      priority: typeof body.priority === "string" ? body.priority : null,
      assigneeName: typeof body.assigneeName === "string" ? body.assigneeName : null,
      assigneeEmail: typeof body.assigneeEmail === "string" ? body.assigneeEmail : null,
      dueDate: dueDateRaw,
      evidenceExcerpt: typeof body.evidenceExcerpt === "string" ? body.evidenceExcerpt : null,
      sourceLocator: typeof body.sourceLocator === "string" ? body.sourceLocator : null,
    },
    await sessionActor()
  );

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ id: result.value.id }, { status: 201 });
}
