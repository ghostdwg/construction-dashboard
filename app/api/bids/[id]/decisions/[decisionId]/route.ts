import { prisma } from "@/lib/prisma";

const VALID_CATEGORIES = new Set([
  "SCOPE",
  "EXCLUSION",
  "SUBSTITUTION",
  "ASSUMPTION",
  "RISK",
  "VE",
  "DESIGN",
  "OTHER",
]);

const VALID_STATUSES = new Set(["OPEN", "SUPERSEDED", "VOID"]);

function serializeDecision(item: {
  id: number;
  bidId: number;
  category: string;
  decision: string;
  rationale: string | null;
  madeBy: string | null;
  madeAt: Date | null;
  impact: string | null;
  status: string;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    bidId: item.bidId,
    category: item.category,
    decision: item.decision,
    rationale: item.rationale,
    madeBy: item.madeBy,
    madeAt: item.madeAt?.toISOString() ?? null,
    impact: item.impact,
    status: item.status,
    source: item.source,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return VALID_CATEGORIES.has(normalized) ? normalized : null;
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return VALID_STATUSES.has(normalized) ? normalized : null;
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

function normalizeOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; decisionId: string }> }
) {
  const { id, decisionId } = await params;
  const bidId = parseInt(id, 10);
  const parsedDecisionId = parseInt(decisionId, 10);

  if (isNaN(bidId) || isNaN(parsedDecisionId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.bidDecision.findUnique({
    where: { id: parsedDecisionId },
  });
  if (!existing) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (existing.bidId !== bidId) {
    return Response.json({ error: "Decision does not belong to this bid" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: {
    category?: string;
    decision?: string;
    rationale?: string | null;
    madeBy?: string | null;
    madeAt?: Date | null;
    impact?: string | null;
    status?: string;
    source?: string | null;
  } = {};

  if ("category" in body) {
    const category = normalizeCategory(body.category);
    if (!category) {
      return Response.json({ error: "Invalid category" }, { status: 400 });
    }
    data.category = category;
  }

  if ("decision" in body) {
    if (typeof body.decision !== "string" || !body.decision.trim()) {
      return Response.json({ error: "Decision is required" }, { status: 400 });
    }
    data.decision = body.decision.trim();
  }

  if ("rationale" in body) {
    const rationale = normalizeOptionalString(body.rationale);
    if (rationale === undefined) {
      return Response.json({ error: "Invalid rationale" }, { status: 400 });
    }
    data.rationale = rationale;
  }

  if ("madeBy" in body) {
    const madeBy = normalizeOptionalString(body.madeBy);
    if (madeBy === undefined) {
      return Response.json({ error: "Invalid madeBy" }, { status: 400 });
    }
    data.madeBy = madeBy;
  }

  if ("madeAt" in body) {
    const madeAt = normalizeOptionalDate(body.madeAt);
    if (madeAt === undefined) {
      return Response.json({ error: "Invalid madeAt" }, { status: 400 });
    }
    data.madeAt = madeAt;
  }

  if ("impact" in body) {
    const impact = normalizeOptionalString(body.impact);
    if (impact === undefined) {
      return Response.json({ error: "Invalid impact" }, { status: 400 });
    }
    data.impact = impact;
  }

  if ("status" in body) {
    const status = normalizeStatus(body.status);
    if (!status) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = status;
  }

  if ("source" in body) {
    const source = normalizeOptionalString(body.source);
    if (source === undefined) {
      return Response.json({ error: "Invalid source" }, { status: 400 });
    }
    data.source = source;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const item = await prisma.bidDecision.update({
    where: { id: parsedDecisionId },
    data,
  });

  return Response.json({
    ok: true,
    decision: serializeDecision(item),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; decisionId: string }> }
) {
  const { id, decisionId } = await params;
  const bidId = parseInt(id, 10);
  const parsedDecisionId = parseInt(decisionId, 10);

  if (isNaN(bidId) || isNaN(parsedDecisionId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.bidDecision.findUnique({
    where: { id: parsedDecisionId },
    select: { id: true, bidId: true },
  });
  if (!existing) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (existing.bidId !== bidId) {
    return Response.json({ error: "Decision does not belong to this bid" }, { status: 403 });
  }

  await prisma.bidDecision.delete({
    where: { id: parsedDecisionId },
  });

  return Response.json({ ok: true });
}
