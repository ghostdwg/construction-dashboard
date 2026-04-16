// GET /api/bids/[id]/procore-export/budget
//
// Exports the project budget as a CSV in Procore's Budget import format.
// Covers two sources:
//   1. Trade budget lines — one row per BidTrade with a committedAmount in H2
//   2. GC overhead lines — from Bid.budgetGcLines JSON (H6)
//
// Procore Budget import columns (Project → Budget → Import):
//   Cost Code, Description, Cost Type, Amount
//
// Cost codes are derived from Trade.csiCode (first 6 chars → "XX XX XX") or
// Trade.costCode if set. Rows with no amount are included at $0 so the
// estimator can fill in the budget after import.

import { prisma } from "@/lib/prisma";

// ── CSV helpers ────────────────────────────────────────────────────────────

function csvEscape(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(values: Array<string | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

function fmtAmount(n: number | null | undefined): string {
  return n != null ? n.toFixed(2) : "0.00";
}

// CSI code "03 30 00" → "03-300" cost code format (fallback when costCode is null)
function deriveCostCode(csiCode: string | null | undefined): string {
  if (!csiCode) return "";
  const parts = csiCode.trim().split(/\s+/);
  if (parts.length >= 2) {
    // "03 30 00" → "03-300" (drop trailing "00" subdivision zeros if uniform)
    const div = parts[0] ?? "";
    const sub = (parts[1] ?? "").replace(/0+$/, "") || "000";
    return `${div}-${sub.padStart(3, "0")}`;
  }
  return csiCode.replace(/\s+/g, "-");
}

// ── GC budget line shape (H6 JSON) ────────────────────────────────────────

type GcLine = { label: string; costCode: string; amount: number };

// ── Handler ────────────────────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, projectName: true, budgetGcLines: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Trade budget lines — all trades regardless of award status so the
  // cost code structure matches the scope even when subs haven't been locked in.
  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    include: {
      trade: { select: { name: true, csiCode: true, costCode: true } },
      buyoutItem: { select: { committedAmount: true } },
    },
    orderBy: { trade: { csiCode: "asc" } },
  });

  // GC overhead lines (H6)
  let gcLines: GcLine[] = [];
  if (bid.budgetGcLines) {
    try {
      const parsed = JSON.parse(bid.budgetGcLines) as GcLine[];
      if (Array.isArray(parsed)) gcLines = parsed;
    } catch {
      // ignore parse failure
    }
  }

  const header = toCsvRow(["Cost Code", "Description", "Cost Type", "Amount"]);
  const rows = [header];

  for (const bt of bidTrades) {
    const costCode = bt.trade.costCode ?? deriveCostCode(bt.trade.csiCode);
    const amount = bt.buyoutItem?.committedAmount ?? null;
    rows.push(
      toCsvRow([costCode, bt.trade.name, "Subcontract", fmtAmount(amount)])
    );
  }

  for (const line of gcLines) {
    rows.push(toCsvRow([line.costCode, line.label, "General Overhead", fmtAmount(line.amount)]));
  }

  const safeName = (bid.projectName ?? "project")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();

  return new Response(rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="procore-budget-${safeName}.csv"`,
    },
  });
}
