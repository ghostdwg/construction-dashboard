import { prisma } from "@/lib/prisma";

const VALID_TIERS = ["preferred", "approved", "new", "inactive"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subId = parseInt(id, 10);

  if (isNaN(subId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const sub = await prisma.subcontractor.findUnique({
      where: { id: subId },
      include: {
        subTrades: { include: { trade: true }, orderBy: { id: "asc" } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
        preferredForTrades: { include: { trade: true } },
      },
    });

    if (!sub) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(sub);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /subcontractors/:id] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subId = parseInt(id, 10);
  if (isNaN(subId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body = await request.json();
    const {
      tier,
      projectTypes,
      region,
      internalNotes,
      doNotUse,
      doNotUseReason,
      company,
      status,
      notes,
      isUnion,
      isMWBE,
      isPreferred,
    } = body as Record<string, unknown>;

    if (tier !== undefined && !VALID_TIERS.includes(tier as string)) {
      return Response.json(
        { error: `tier must be one of: ${VALID_TIERS.join(", ")}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (company !== undefined) data.company = String(company).trim();
    if (status !== undefined) data.status = String(status);
    if (notes !== undefined) data.notes = notes;
    if (isUnion !== undefined) data.isUnion = Boolean(isUnion);
    if (isMWBE !== undefined) data.isMWBE = Boolean(isMWBE);
    if (isPreferred !== undefined) data.isPreferred = Boolean(isPreferred);
    if (tier !== undefined) data.tier = String(tier);
    if (projectTypes !== undefined) data.projectTypes = String(projectTypes);
    if (region !== undefined) data.region = region;
    if (internalNotes !== undefined) data.internalNotes = internalNotes;
    if (doNotUse !== undefined) data.doNotUse = Boolean(doNotUse);
    if (doNotUseReason !== undefined) data.doNotUseReason = doNotUseReason;

    if (Object.keys(data).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }

    const sub = await prisma.subcontractor.update({
      where: { id: subId },
      data,
    });

    return Response.json(sub);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /subcontractors/:id] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/subcontractors/[id]
// Removes a subcontractor and all related join records.
// Returns 409 if the sub is referenced by any active bid (selections, estimates,
// outreach, etc.) — those records must be cleaned up first to avoid breaking history.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subId = parseInt(id, 10);
  if (isNaN(subId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    // Check for references that would block deletion
    const [selectionCount, estimateCount, outreachCount] = await Promise.all([
      prisma.bidInviteSelection.count({ where: { subcontractorId: subId } }),
      prisma.estimateUpload.count({ where: { subcontractorId: subId } }),
      prisma.outreachLog.count({ where: { subcontractorId: subId } }),
    ]);

    if (selectionCount + estimateCount + outreachCount > 0) {
      return Response.json(
        {
          error: "Cannot delete: subcontractor is referenced by existing bid records",
          selections: selectionCount,
          estimates: estimateCount,
          outreachLogs: outreachCount,
        },
        { status: 409 }
      );
    }

    // Cascade-delete owned records (contacts, trade joins, preferred-sub joins)
    await prisma.$transaction([
      prisma.contact.deleteMany({ where: { subcontractorId: subId } }),
      prisma.subcontractorTrade.deleteMany({ where: { subcontractorId: subId } }),
      prisma.preferredSub.deleteMany({ where: { subcontractorId: subId } }),
      prisma.subcontractor.delete({ where: { id: subId } }),
    ]);

    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Record to delete does not exist")) {
      return Response.json({ error: "Subcontractor not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /subcontractors/:id] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
