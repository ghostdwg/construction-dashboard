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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true },
  });
  if (!bid) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  const decisions = await prisma.bidDecision.findMany({
    where: { bidId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    ok: true,
    decisions: decisions.map(serializeDecision),
  });
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

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true },
  });
  if (!bid) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const category = normalizeCategory(body.category);
  if (!category) {
    return Response.json({ error: "Invalid category" }, { status: 400 });
  }

  if (typeof body.decision !== "string" || !body.decision.trim()) {
    return Response.json({ error: "Decision is required" }, { status: 400 });
  }

  const rationale = normalizeOptionalString(body.rationale);
  if (body.rationale !== undefined && rationale === undefined) {
    return Response.json({ error: "Invalid rationale" }, { status: 400 });
  }

  const madeBy = normalizeOptionalString(body.madeBy);
  if (body.madeBy !== undefined && madeBy === undefined) {
    return Response.json({ error: "Invalid madeBy" }, { status: 400 });
  }

  const madeAt = normalizeOptionalDate(body.madeAt);
  if (body.madeAt !== undefined && madeAt === undefined) {
    return Response.json({ error: "Invalid madeAt" }, { status: 400 });
  }

  const impact = normalizeOptionalString(body.impact);
  if (body.impact !== undefined && impact === undefined) {
    return Response.json({ error: "Invalid impact" }, { status: 400 });
  }

  const source = normalizeOptionalString(body.source);
  if (body.source !== undefined && source === undefined) {
    return Response.json({ error: "Invalid source" }, { status: 400 });
  }

  const status =
    body.status === undefined ? "OPEN" : normalizeStatus(body.status);
  if (!status) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const item = await prisma.bidDecision.create({
    data: {
      bidId,
      category,
      decision: body.decision.trim(),
      rationale,
      madeBy,
      madeAt,
      impact,
      status,
      source,
    },
  });

  return Response.json({
    ok: true,
    decision: serializeDecision(item),
  });
}
