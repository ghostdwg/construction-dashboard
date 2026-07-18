// Module OPS2 (Slice 2) — create a TrackedItem FROM a Field Report.
//
// POST …/field-reports/[fieldReportId]/tracked-items
//   Body: { title, description?, priority?, assigneeName?, dueDate?,
//           evidenceExcerpt?, sourceLocator? }
//
// HUMAN-TRIGGERED only — uploads/parsing never create items. The new item
// lands on the shared TrackedItem spine: kind FIELD_ITEM, sourceKind
// "field_report", sourceFieldReportId citation, extractionMethod "manual",
// citationVerified false. Cross-bid reports are rejected by the service's
// tenancy check. No auto-assign, no auto-close, no notifications.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { createItemFromFieldReport } from "@/lib/services/trackedItems";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldReportId: string }> }
) {
  const { id, fieldReportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(fieldReportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let dueDate: Date | null = null;
  if (typeof body.dueDate === "string") {
    dueDate = new Date(body.dueDate);
    if (isNaN(dueDate.getTime()))
      return Response.json({ error: "Invalid dueDate" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await createItemFromFieldReport(
    bidId,
    rid,
    {
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : null,
      priority: typeof body.priority === "string" ? body.priority : null,
      assigneeName: typeof body.assigneeName === "string" ? body.assigneeName : null,
      dueDate,
      evidenceExcerpt: typeof body.evidenceExcerpt === "string" ? body.evidenceExcerpt : null,
      sourceLocator: typeof body.sourceLocator === "string" ? body.sourceLocator : null,
    },
    { id: access.user.id, name: user?.name ?? null, email: user?.email ?? null }
  );

  if (!result.ok) {
    const status = /not found/i.test(result.error) ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ id: result.value.id }, { status: 201 });
}
