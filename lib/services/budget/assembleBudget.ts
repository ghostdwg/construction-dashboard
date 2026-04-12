// Module H6 — Budget Creation service
//
// Assembles a project budget from BuyoutItem (trade lines) + Bid.budgetGcLines
// (GC overhead items stored as JSON). The budget is the document the PM uses
// to set up the project in their accounting/ERP system.
//
// Trade lines include ALL trades on the bid (even $0 committed) so the PM
// gets the complete cost code structure. GC lines use Division 1 cost codes
// which don't collide with the trade dictionary (starts at Division 2).

import { prisma } from "@/lib/prisma";
import { loadBuyoutItemsForBid } from "@/lib/services/buyout/buyoutService";

// ── Types ──────────────────────────────────────────────────────────────────

export type BudgetTradeLine = {
  costCode: string | null;
  csiCode: string | null;
  tradeName: string;
  subcontractorName: string | null;
  committedAmount: number;
  changeOrderAmount: number;
  totalAmount: number;
};

export type BudgetGcLine = {
  label: string;
  costCode: string;
  amount: number;
};

export type ProjectBudget = {
  generatedAt: string;
  project: {
    name: string;
    number: string;
    location: string | null;
  };
  tradeLines: BudgetTradeLine[];
  tradeSubtotal: number;
  gcLines: BudgetGcLine[];
  gcSubtotal: number;
  grandTotal: number;
};

// ── Default GC lines ───────────────────────────────────────────────────────

const DEFAULT_GC_LINES: BudgetGcLine[] = [
  { label: "General Conditions", costCode: "1.001", amount: 0 },
  { label: "General Liability Insurance", costCode: "1.010", amount: 0 },
  { label: "Builder's Risk Insurance", costCode: "1.011", amount: 0 },
  { label: "Performance & Payment Bond", costCode: "1.020", amount: 0 },
  { label: "Overhead", costCode: "1.030", amount: 0 },
  { label: "Profit", costCode: "1.040", amount: 0 },
  { label: "Contingency", costCode: "1.050", amount: 0 },
];

// ── Parsing ────────────────────────────────────────────────────────────────

function parseGcLines(json: string | null): BudgetGcLine[] {
  if (!json) return DEFAULT_GC_LINES.map((l) => ({ ...l }));
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return DEFAULT_GC_LINES.map((l) => ({ ...l }));
    return parsed.filter(
      (l: unknown) =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as Record<string, unknown>).label === "string" &&
        typeof (l as Record<string, unknown>).costCode === "string" &&
        typeof (l as Record<string, unknown>).amount === "number"
    ) as BudgetGcLine[];
  } catch {
    return DEFAULT_GC_LINES.map((l) => ({ ...l }));
  }
}

function costCodeSortKey(code: string | null): number {
  if (!code) return 999;
  return parseFloat(code) || 999;
}

// ── Assembler ──────────────────────────────────────────────────────────────

export async function assembleBudget(
  bidId: number
): Promise<ProjectBudget | null> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      id: true,
      projectName: true,
      location: true,
      budgetGcLines: true,
    },
  });
  if (!bid) return null;

  const buyoutItems = await loadBuyoutItemsForBid(bidId);

  const tradeLines: BudgetTradeLine[] = buyoutItems
    .sort((a, b) => costCodeSortKey(a.costCode) - costCodeSortKey(b.costCode))
    .map((b) => ({
      costCode: b.costCode,
      csiCode: b.csiCode,
      tradeName: b.tradeName,
      subcontractorName: b.subcontractorName,
      committedAmount: b.committedAmount ?? 0,
      changeOrderAmount: b.changeOrderAmount,
      totalAmount: b.totalCommitted,
    }));

  const tradeSubtotal = tradeLines.reduce((s, t) => s + t.totalAmount, 0);

  const gcLines = parseGcLines(bid.budgetGcLines);
  const gcSubtotal = gcLines.reduce((s, g) => s + g.amount, 0);
  const grandTotal = tradeSubtotal + gcSubtotal;

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: bid.projectName,
      number: `Bid #${bid.id}`,
      location: bid.location,
    },
    tradeLines,
    tradeSubtotal,
    gcLines,
    gcSubtotal,
    grandTotal,
  };
}

// ── GC lines persistence ───────────────────────────────────────────────────

export type UpdateGcLinesResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateBudgetGcLines(
  bidId: number,
  lines: unknown
): Promise<UpdateGcLinesResult> {
  if (!Array.isArray(lines)) {
    return { ok: false, error: "gcLines must be an array" };
  }

  const validated: BudgetGcLine[] = [];
  for (const l of lines) {
    if (typeof l !== "object" || l === null) {
      return { ok: false, error: "Each GC line must be an object" };
    }
    const obj = l as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    const costCode = typeof obj.costCode === "string" ? obj.costCode.trim() : "";
    const amount = typeof obj.amount === "number" ? obj.amount : NaN;

    if (!label) return { ok: false, error: "Each GC line must have a non-empty label" };
    if (!costCode) return { ok: false, error: "Each GC line must have a non-empty costCode" };
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: `${label}: amount must be a non-negative number` };
    }
    validated.push({ label, costCode, amount });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true },
  });
  if (!bid) return { ok: false, error: "Bid not found" };

  await prisma.bid.update({
    where: { id: bidId },
    data: { budgetGcLines: JSON.stringify(validated) },
  });

  return { ok: true };
}
