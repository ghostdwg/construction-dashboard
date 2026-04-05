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
