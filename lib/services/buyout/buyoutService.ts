// Module H2 — Buyout Tracker service layer
//
// Responsibilities:
// 1. Ensure a BuyoutItem exists for every BidTrade (auto-create on first read).
// 2. Load buyout items for a bid with all the data the UI needs.
// 3. Compute a financial rollup across all buyout items for a bid.
// 4. Validate + apply updates to a single BuyoutItem.
//
// Pricing boundary: committedAmount is the amount WE are committing to pay a sub.
// This is an outbound commitment, not inbound pricing data from a sub's estimate.
// EstimateUpload.pricingData is never touched here.

import { prisma } from "@/lib/prisma";

// ── Contract status ─────────────────────────────────────────────────────────

export const CONTRACT_STATUSES = [
  "PENDING",
  "LOI_SENT",
  "CONTRACT_SENT",
  "CONTRACT_SIGNED",
  "PO_ISSUED",
  "ACTIVE",
  "CLOSED",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export function isValidContractStatus(s: string): s is ContractStatus {
  return (CONTRACT_STATUSES as readonly string[]).includes(s);
}

// ── Types ───────────────────────────────────────────────────────────────────

export type BuyoutItemRow = {
  id: number;
  bidTradeId: number;
  tradeId: number;
  tradeName: string;
  csiCode: string | null;
  tier: string;

  subcontractorId: number | null;
  subcontractorName: string | null;

  committedAmount: number | null;
  originalBidAmount: number | null;

  contractStatus: ContractStatus;
  loiSentAt: string | null;
  contractSentAt: string | null;
  contractSignedAt: string | null;
  poNumber: string | null;
  poIssuedAt: string | null;

  changeOrderAmount: number;
  paidToDate: number;
  retainagePercent: number;

  // Derived
  totalCommitted: number; // committedAmount + changeOrderAmount
  remainingToPay: number; // totalCommitted - paidToDate
  retainageHeld: number; // paidToDate * (retainagePercent / 100)

  notes: string | null;
};

export type BuyoutRollup = {
  tradeCount: number;
  tradesCommitted: number; // trades with a committedAmount set
  tradesAwarded: number; // trades with a subcontractorId set

  totalCommitted: number; // sum of committedAmount + changeOrderAmount
  totalPaid: number; // sum of paidToDate
  totalRemaining: number; // committed - paid
  totalRetainageHeld: number;

  byStatus: Record<ContractStatus, number>; // count of items per status
};

// ── Core operations ─────────────────────────────────────────────────────────

/**
 * Ensures every BidTrade for the given bid has a BuyoutItem. Returns nothing;
 * call loadBuyoutItemsForBid after to get the result set.
 *
 * Derives the awarded subcontractorId from BidInviteSelection.rfqStatus === "accepted"
 * at creation time. After creation, the sub assignment is manual.
 */
async function ensureBuyoutItemsForBid(bidId: number): Promise<void> {
  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    select: {
      id: true,
      tradeId: true,
      buyoutItem: { select: { id: true } },
    },
  });

  const missing = bidTrades.filter((bt) => !bt.buyoutItem);
  if (missing.length === 0) return;

  // For trades without a buyout item, look up any accepted selection to seed
  // the awarded sub.
  const tradeIds = missing.map((bt) => bt.tradeId);
  const acceptedSelections = await prisma.bidInviteSelection.findMany({
    where: {
      bidId,
      tradeId: { in: tradeIds },
      rfqStatus: "accepted",
    },
    select: { tradeId: true, subcontractorId: true },
  });
  const acceptedByTrade = new Map<number, number>();
  for (const sel of acceptedSelections) {
    if (sel.tradeId != null && !acceptedByTrade.has(sel.tradeId)) {
      acceptedByTrade.set(sel.tradeId, sel.subcontractorId);
    }
  }

  // Create each missing row individually (Prisma createMany on SQLite can't
  // skipDuplicates in all versions — safer to loop).
  for (const bt of missing) {
    await prisma.buyoutItem.create({
      data: {
        bidId,
        bidTradeId: bt.id,
        subcontractorId: acceptedByTrade.get(bt.tradeId) ?? null,
        contractStatus: "PENDING",
      },
    });
  }
}

/**
 * Loads all buyout items for a bid, auto-creating rows for any BidTrade that
 * doesn't have one yet. Joins trade + subcontractor for display.
 */
export async function loadBuyoutItemsForBid(bidId: number): Promise<BuyoutItemRow[]> {
  await ensureBuyoutItemsForBid(bidId);

  const items = await prisma.buyoutItem.findMany({
    where: { bidId },
    include: {
      bidTrade: { include: { trade: true } },
      subcontractor: { select: { id: true, company: true } },
    },
    orderBy: { bidTradeId: "asc" },
  });

  return items.map((it) => {
    const committed = it.committedAmount ?? 0;
    const changeOrders = it.changeOrderAmount ?? 0;
    const paid = it.paidToDate ?? 0;
    const retainagePct = it.retainagePercent ?? 0;
    const totalCommitted = committed + changeOrders;
    const remainingToPay = Math.max(0, totalCommitted - paid);
    const retainageHeld = paid * (retainagePct / 100);

    return {
      id: it.id,
      bidTradeId: it.bidTradeId,
      tradeId: it.bidTrade.tradeId,
      tradeName: it.bidTrade.trade.name,
      csiCode: it.bidTrade.trade.csiCode,
      tier: it.bidTrade.tier,

      subcontractorId: it.subcontractorId,
      subcontractorName: it.subcontractor?.company ?? null,

      committedAmount: it.committedAmount,
      originalBidAmount: it.originalBidAmount,

      contractStatus: (isValidContractStatus(it.contractStatus)
        ? it.contractStatus
        : "PENDING") as ContractStatus,
      loiSentAt: it.loiSentAt?.toISOString() ?? null,
      contractSentAt: it.contractSentAt?.toISOString() ?? null,
      contractSignedAt: it.contractSignedAt?.toISOString() ?? null,
      poNumber: it.poNumber,
      poIssuedAt: it.poIssuedAt?.toISOString() ?? null,

      changeOrderAmount: changeOrders,
      paidToDate: paid,
      retainagePercent: retainagePct,

      totalCommitted,
      remainingToPay,
      retainageHeld,

      notes: it.notes,
    };
  });
}

/**
 * Computes a financial rollup across all buyout items for a bid.
 */
export function computeBuyoutRollup(items: BuyoutItemRow[]): BuyoutRollup {
  const byStatus: Record<ContractStatus, number> = {
    PENDING: 0,
    LOI_SENT: 0,
    CONTRACT_SENT: 0,
    CONTRACT_SIGNED: 0,
    PO_ISSUED: 0,
    ACTIVE: 0,
    CLOSED: 0,
  };

  let totalCommitted = 0;
  let totalPaid = 0;
  let totalRetainage = 0;
  let tradesCommitted = 0;
  let tradesAwarded = 0;

  for (const it of items) {
    byStatus[it.contractStatus] = (byStatus[it.contractStatus] ?? 0) + 1;
    totalCommitted += it.totalCommitted;
    totalPaid += it.paidToDate;
    totalRetainage += it.retainageHeld;
    if (it.committedAmount != null && it.committedAmount > 0) tradesCommitted += 1;
    if (it.subcontractorId != null) tradesAwarded += 1;
  }

  return {
    tradeCount: items.length,
    tradesCommitted,
    tradesAwarded,
    totalCommitted,
    totalPaid,
    totalRemaining: Math.max(0, totalCommitted - totalPaid),
    totalRetainageHeld: totalRetainage,
    byStatus,
  };
}

// ── Update ──────────────────────────────────────────────────────────────────

export type BuyoutUpdateInput = {
  subcontractorId?: number | null;
  committedAmount?: number | null;
  originalBidAmount?: number | null;
  contractStatus?: string;
  loiSentAt?: string | null;
  contractSentAt?: string | null;
  contractSignedAt?: string | null;
  poNumber?: string | null;
  poIssuedAt?: string | null;
  changeOrderAmount?: number | null;
  paidToDate?: number | null;
  retainagePercent?: number | null;
  notes?: string | null;
};

export type BuyoutUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validates and applies an update to a single BuyoutItem. The item must
 * belong to the given bidId (ownership check).
 */
export async function updateBuyoutItem(
  bidId: number,
  itemId: number,
  input: BuyoutUpdateInput
): Promise<BuyoutUpdateResult> {
  const existing = await prisma.buyoutItem.findUnique({
    where: { id: itemId },
    select: { id: true, bidId: true },
  });
  if (!existing) return { ok: false, error: "Buyout item not found" };
  if (existing.bidId !== bidId) return { ok: false, error: "Buyout item does not belong to this bid" };

  // Validate contractStatus
  if (input.contractStatus !== undefined && !isValidContractStatus(input.contractStatus)) {
    return {
      ok: false,
      error: `Invalid contractStatus. Must be one of: ${CONTRACT_STATUSES.join(", ")}`,
    };
  }

  // Validate numeric fields are non-negative when provided
  for (const [key, val] of [
    ["committedAmount", input.committedAmount],
    ["originalBidAmount", input.originalBidAmount],
    ["changeOrderAmount", input.changeOrderAmount],
    ["paidToDate", input.paidToDate],
    ["retainagePercent", input.retainagePercent],
  ] as const) {
    if (val != null && (typeof val !== "number" || !Number.isFinite(val) || val < 0)) {
      return { ok: false, error: `${key} must be a non-negative number` };
    }
  }
  if (
    input.retainagePercent != null &&
    typeof input.retainagePercent === "number" &&
    input.retainagePercent > 100
  ) {
    return { ok: false, error: "retainagePercent must be between 0 and 100" };
  }

  // Build the update payload — only include keys explicitly present in input
  const data: Record<string, unknown> = {};
  if ("subcontractorId" in input) data.subcontractorId = input.subcontractorId;
  if ("committedAmount" in input) data.committedAmount = input.committedAmount;
  if ("originalBidAmount" in input) data.originalBidAmount = input.originalBidAmount;
  if ("contractStatus" in input) data.contractStatus = input.contractStatus;
  if ("loiSentAt" in input) data.loiSentAt = input.loiSentAt ? new Date(input.loiSentAt) : null;
  if ("contractSentAt" in input) data.contractSentAt = input.contractSentAt ? new Date(input.contractSentAt) : null;
  if ("contractSignedAt" in input)
    data.contractSignedAt = input.contractSignedAt ? new Date(input.contractSignedAt) : null;
  if ("poNumber" in input) data.poNumber = input.poNumber;
  if ("poIssuedAt" in input) data.poIssuedAt = input.poIssuedAt ? new Date(input.poIssuedAt) : null;
  if ("changeOrderAmount" in input) data.changeOrderAmount = input.changeOrderAmount ?? 0;
  if ("paidToDate" in input) data.paidToDate = input.paidToDate ?? 0;
  if ("retainagePercent" in input) data.retainagePercent = input.retainagePercent ?? 0;
  if ("notes" in input) data.notes = input.notes;

  await prisma.buyoutItem.update({
    where: { id: itemId },
    data,
  });

  return { ok: true };
}
