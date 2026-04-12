// Module H5 — Owner-Facing Estimate assembly
//
// Produces a trade-level cost summary for sharing with the project owner.
// Shows aggregated GC commitments (from BuyoutItem) plus estimator-supplied
// markup, contingency, exclusions, and qualifications.
//
// Privacy boundary: sub names, contract status, PO numbers, retainage, and
// paid-to-date are stripped. Only trade name + CSI code + committed amount
// appear. This is a GC-prepared document, not a sub-submitted estimate.

import { prisma } from "@/lib/prisma";
import { loadBuyoutItemsForBid } from "@/lib/services/buyout/buyoutService";

// ── Types ──────────────────────────────────────────────────────────────────

export type OwnerEstimateInput = {
  markupLines: Array<{ label: string; amount: number }>;
  contingencyPercent: number;
  exclusions: string;
  qualifications: string;
  validUntil: string | null;
};

export type OwnerEstimateTradeRow = {
  tradeName: string;
  csiCode: string | null;
  committedAmount: number;
};

export type OwnerEstimate = {
  generatedAt: string;
  project: {
    name: string;
    location: string | null;
    deliveryMethod: string | null;
    buildingType: string | null;
    approxSqft: number | null;
    stories: number | null;
    ownerType: string | null;
  };
  trades: OwnerEstimateTradeRow[];
  tradeSubtotal: number;
  markupLines: Array<{ label: string; amount: number }>;
  markupTotal: number;
  subtotalBeforeContingency: number;
  contingencyPercent: number;
  contingencyAmount: number;
  grandTotal: number;
  exclusions: string;
  qualifications: string;
  validUntil: string | null;
};

// ── Labels ─────────────────────────────────────────────────────────────────

const DELIVERY_LABELS: Record<string, string> = {
  HARD_BID: "Hard Bid",
  DESIGN_BUILD: "Design-Build",
  CM_AT_RISK: "CM at Risk",
  NEGOTIATED: "Negotiated",
};
const OWNER_LABELS: Record<string, string> = {
  PUBLIC_ENTITY: "Public Entity",
  PRIVATE_OWNER: "Private Owner",
  DEVELOPER: "Developer",
  INSTITUTIONAL: "Institutional",
};

// ── Assembler ──────────────────────────────────────────────────────────────

export async function assembleOwnerEstimate(
  bidId: number,
  input: OwnerEstimateInput
): Promise<OwnerEstimate | null> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      id: true,
      projectName: true,
      location: true,
      deliveryMethod: true,
      buildingType: true,
      approxSqft: true,
      stories: true,
      ownerType: true,
    },
  });
  if (!bid) return null;

  const buyoutItems = await loadBuyoutItemsForBid(bidId);

  const trades: OwnerEstimateTradeRow[] = buyoutItems
    .filter((b) => b.totalCommitted > 0)
    .sort((a, b) => {
      if (a.csiCode && b.csiCode) return a.csiCode.localeCompare(b.csiCode);
      if (a.csiCode) return -1;
      if (b.csiCode) return 1;
      return a.tradeName.localeCompare(b.tradeName);
    })
    .map((b) => ({
      tradeName: b.tradeName,
      csiCode: b.csiCode,
      committedAmount: b.totalCommitted,
    }));

  const tradeSubtotal = trades.reduce((s, t) => s + t.committedAmount, 0);
  const markupTotal = input.markupLines.reduce((s, m) => s + m.amount, 0);
  const subtotalBeforeContingency = tradeSubtotal + markupTotal;
  const contingencyAmount = Math.round(
    subtotalBeforeContingency * (input.contingencyPercent / 100)
  );
  const grandTotal = subtotalBeforeContingency + contingencyAmount;

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: bid.projectName,
      location: bid.location,
      deliveryMethod: bid.deliveryMethod
        ? DELIVERY_LABELS[bid.deliveryMethod] ?? bid.deliveryMethod
        : null,
      buildingType: bid.buildingType,
      approxSqft: bid.approxSqft,
      stories: bid.stories,
      ownerType: bid.ownerType
        ? OWNER_LABELS[bid.ownerType] ?? bid.ownerType
        : null,
    },
    trades,
    tradeSubtotal,
    markupLines: input.markupLines,
    markupTotal,
    subtotalBeforeContingency,
    contingencyPercent: input.contingencyPercent,
    contingencyAmount,
    grandTotal,
    exclusions: input.exclusions,
    qualifications: input.qualifications,
    validUntil: input.validUntil,
  };
}
