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
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  createTrackedItem,
  itemIdsWithDispositions,
  listTrackedItems,
} from "@/lib/services/trackedItems";
import { deriveConsultantBadge } from "@/lib/services/trackedItems/consultantBadge";

const GAP_HINT_STOPWORDS = new Set([
  "with", "from", "that", "this", "have", "will", "more", "than",
  "when", "also", "were", "been", "being", "they", "their", "over",
  "under", "each", "some", "into", "work", "area", "type",
]);

function tokenizeForHint(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GAP_HINT_STOPWORDS.has(w));
}

function countMatchingSections(itemTitle: string, sectionTitles: string[]): number {
  const tokens = tokenizeForHint(itemTitle);
  if (tokens.length === 0) return 0;
  return sectionTitles.filter((st) => tokens.some((t) => st.includes(t))).length;
}

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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(request.url);
  const items = await listTrackedItems(bidId, {
    kind: searchParams.get("kind") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    assigneeName: searchParams.get("assignee") ?? undefined,
  });

  // Phase 1B — badge is derived at read time from live facts (never stored).
  const disposedItemIds = await itemIdsWithDispositions(
    bidId,
    items.map((i) => i.id)
  );

  // Spec gap hints: load uncovered sections once, compute keyword-overlap count per item.
  const specBook = await prisma.specBook.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    select: { sections: { where: { covered: false }, select: { csiTitle: true } } },
  });
  const uncoveredTitles = (specBook?.sections ?? []).map((s) => s.csiTitle.toLowerCase());

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
      sourceConsultantObservationId: i.sourceConsultantObservationId,
      evidenceExcerpt: i.evidenceExcerpt,
      sourceLocator: i.sourceLocator,
      extractionMethod: i.extractionMethod,
      citationVerified: i.citationVerified,
      carriedFromDate: i.carriedFromDate,
      closedAt: i.closedAt?.toISOString() ?? null,
      closedBy: i.closedBy,
      waivedReason: i.waivedReason,
      formalResponse: i.formalResponse,
      formalResponseBy: i.formalResponseBy,
      formalResponseAt: i.formalResponseAt?.toISOString() ?? null,
      pmReviewRequired: i.pmReviewRequired,
      consultantBadge: deriveConsultantBadge({
        hasLinkedObservation: i._count.supportingObservations > 0,
        hasFormalResponse: i.formalResponse != null,
        hasDispositionRecord: disposedItemIds.has(i.id),
      }),
      commentCount: i._count.comments,
      attachmentCount: i._count.attachments,
      createdAt: i.createdAt.toISOString(),
      gapHintCount: countMatchingSections(i.title, uncoveredTitles),
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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

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
    { ...(await sessionActor()), id: access.user.id }
  );

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ id: result.value.id }, { status: 201 });
}
