// GET  /api/bids/[id]/submittals/packages
//   Returns all SubmittalPackages for the bid, each with their items and
//   progress stats. Also returns unassigned items (packageId = null) and
//   an overall rollup used by the register header.
//
// POST /api/bids/[id]/submittals/packages
//   Create a new package. Auto-allocates the next PKG-XX number.

import { prisma } from "@/lib/prisma";

const VALID_SEVERITY = new Set(["CRITICAL", "HIGH", "MODERATE", "LOW", "INFO"]);

function severityFromExtractions(
  aiExtractions: string | null | undefined
): string | null {
  if (!aiExtractions) return null;
  try {
    const parsed = JSON.parse(aiExtractions) as { severity?: string };
    const sev = (parsed.severity ?? "").toUpperCase();
    return VALID_SEVERITY.has(sev) ? sev : null;
  } catch {
    return null;
  }
}

// Shared item select — used for both package items and unassigned items
const ITEM_SELECT = {
  id: true,
  submittalNumber: true,
  title: true,
  type: true,
  status: true,
  requiredBy: true,
  specSection: { select: { csiNumber: true, aiExtractions: true } },
  responsibleSubId: true,
  responsibleSub: { select: { id: true, company: true } },
  reviewer: true,
  notes: true,
  description: true,
} as const;

type DbItem = {
  id: number;
  submittalNumber: string | null;
  title: string;
  type: string;
  status: string;
  requiredBy: Date | null;
  specSection: { csiNumber: string; aiExtractions: string | null } | null;
  responsibleSubId: number | null;
  responsibleSub: { id: number; company: string } | null;
  reviewer: string | null;
  notes: string | null;
  description: string | null;
};

const isTerminal = (s: string) => s === "APPROVED" || s === "APPROVED_AS_NOTED";

function mapItem(it: DbItem, now: number) {
  return {
    id: it.id,
    submittalNumber: it.submittalNumber,
    title: it.title,
    type: it.type,
    status: it.status,
    requiredBy: it.requiredBy?.toISOString() ?? null,
    specSectionNumber: it.specSection?.csiNumber ?? null,
    responsibleSubId: it.responsibleSubId,
    responsibleSubName: it.responsibleSub?.company ?? null,
    reviewer: it.reviewer,
    notes: it.notes,
    description: it.description,
    isOverdue:
      it.requiredBy != null &&
      it.requiredBy.getTime() < now &&
      !isTerminal(it.status),
    severity: severityFromExtractions(it.specSection?.aiExtractions),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const [packages, unassignedItems] = await Promise.all([
    prisma.submittalPackage.findMany({
      where: { bidId },
      include: {
        bidTrade: {
          include: { trade: { select: { name: true, csiCode: true } } },
        },
        items: {
          select: ITEM_SELECT,
          orderBy: [{ submittalNumber: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { packageNumber: "asc" },
    }),
    prisma.submittalItem.findMany({
      where: { bidId, packageId: null },
      select: {
        ...ITEM_SELECT,
        bidTrade: { include: { trade: { select: { name: true } } } },
      },
      orderBy: [{ submittalNumber: "asc" }, { id: "asc" }],
    }),
  ]);

  const now = Date.now();

  const result = packages.map((pkg) => {
    const total = pkg.items.length;
    const approved = pkg.items.filter((i) => isTerminal(i.status)).length;
    const overdue = pkg.items.filter(
      (i) =>
        i.requiredBy != null &&
        i.requiredBy.getTime() < now &&
        !isTerminal(i.status)
    ).length;
    return {
      id: pkg.id,
      packageNumber: pkg.packageNumber,
      name: pkg.name,
      bidTradeId: pkg.bidTradeId,
      tradeName: pkg.bidTrade?.trade.name ?? null,
      tradeCsiCode: pkg.bidTrade?.trade.csiCode ?? null,
      status: pkg.status,
      responsibleContractor: pkg.responsibleContractor,
      submittalManager: pkg.submittalManager,
      total,
      approved,
      overdue,
      items: pkg.items.map((i) => mapItem(i, now)),
    };
  });

  const unassigned = unassignedItems.map((it) => ({
    ...mapItem(it, now),
    tradeName: it.bidTrade?.trade.name ?? null,
  }));

  // Overall rollup across all items
  const allItems = [...result.flatMap((p) => p.items), ...unassigned];
  const rollup = {
    total: allItems.length,
    open: allItems.filter((i) => !isTerminal(i.status)).length,
    approved: allItems.filter((i) => isTerminal(i.status)).length,
    overdue: allItems.filter((i) => i.isOverdue).length,
    critical: allItems.filter((i) => i.severity === "CRITICAL").length,
  };

  return Response.json({ packages: result, unassigned, rollup });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json()) as {
    name?: string;
    bidTradeId?: number | null;
  };
  if (!body.name?.trim())
    return Response.json({ error: "name is required" }, { status: 400 });

  // Auto-allocate next PKG-XX number
  const existing = await prisma.submittalPackage.findMany({
    where: { bidId },
    select: { packageNumber: true },
  });
  const nums = new Set(existing.map((p) => p.packageNumber));
  let seq = 1;
  while (nums.has(`PKG-${String(seq).padStart(2, "0")}`)) seq++;
  const packageNumber = `PKG-${String(seq).padStart(2, "0")}`;

  const pkg = await prisma.submittalPackage.create({
    data: {
      bidId,
      packageNumber,
      name: body.name.trim(),
      status: "DRAFT",
      bidTradeId: body.bidTradeId ?? null,
    },
  });
  return Response.json({
    ok: true,
    id: pkg.id,
    packageNumber: pkg.packageNumber,
  });
}
