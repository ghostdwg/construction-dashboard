import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

// ----- Types -----

export type AiSafePayload = {
  exportMetadata: {
    exportId: string;
    generatedAt: string;
    bidPackageName: string;
    projectType: string | null;
    tradeCount: number;
    scopeItemCount: number;
    restrictedItemsStripped: number;
  };
  trades: {
    tradeName: string;
    costCode: string | null;
    csiCode: string | null;
    scopeItems: {
      description: string;
      inclusion: boolean;
      specSection: string | null;
      drawingRef: string | null;
      notes: string | null;
      riskFlag: boolean;
    }[];
  }[];
};

// ----- Safety helpers -----

// Fields that must never appear in the output — matched by key name.
const BANNED_FIELD_PATTERNS = [
  "budget", "estimate", "cost", "price", "amount",
  "target", "buyout", "contingency", "margin", "fee",
];

function containsBannedField(obj: unknown): boolean {
  if (obj === null || typeof obj !== "object") return false;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const lk = key.toLowerCase();
    if (BANNED_FIELD_PATTERNS.some((p) => lk.includes(p))) return true;
    if (containsBannedField((obj as Record<string, unknown>)[key])) return true;
  }
  return false;
}

function assertNoRestrictedItems(payload: AiSafePayload): void {
  // The payload doesn't carry a `restricted` field — that's intentional.
  // This second-pass guard catches any future schema drift that re-adds it.
  for (const trade of payload.trades) {
    for (const item of trade.scopeItems) {
      if ("restricted" in item && (item as { restricted?: boolean }).restricted === true) {
        throw new Error(
          "SAFETY VIOLATION: restricted scope item found in AI export payload"
        );
      }
    }
  }

  if (containsBannedField(payload)) {
    throw new Error(
      "SAFETY VIOLATION: banned cost/budget field detected in AI export payload"
    );
  }
}

// ----- Main export builder -----

export async function buildAiSafePayload(bidId: number): Promise<{
  payload: AiSafePayload;
  restrictedCount: number;
}> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      projectName: true,
      description: true,
      scopeItems: {
        include: {
          trade: {
            select: {
              name: true,
              costCode: true,
              csiCode: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!bid) throw new Error(`Bid ${bidId} not found`);

  // Separate restricted items and count them
  const allItems = bid.scopeItems;
  const publicItems = allItems.filter((i) => !i.restricted);
  const restrictedCount = allItems.length - publicItems.length;

  // Group by trade — items with no trade go into a synthetic "Unassigned" group
  type TradeKey = string; // "unassigned" or String(tradeId)
  type TradeGroup = {
    tradeName: string;
    costCode: string | null;
    csiCode: string | null;
    items: typeof publicItems;
  };

  const tradeMap = new Map<TradeKey, TradeGroup>();

  for (const item of publicItems) {
    if (item.trade) {
      const key = String(item.tradeId);
      if (!tradeMap.has(key)) {
        tradeMap.set(key, {
          tradeName: item.trade.name,
          costCode: item.trade.costCode ?? null,
          csiCode: item.trade.csiCode ?? null,
          items: [],
        });
      }
      tradeMap.get(key)!.items.push(item);
    } else {
      if (!tradeMap.has("unassigned")) {
        tradeMap.set("unassigned", {
          tradeName: "Unassigned",
          costCode: null,
          csiCode: null,
          items: [],
        });
      }
      tradeMap.get("unassigned")!.items.push(item);
    }
  }

  // Build safe trade array — only the fields defined in the spec
  const trades: AiSafePayload["trades"] = [];
  for (const group of tradeMap.values()) {
    if (group.items.length === 0) continue;
    trades.push({
      tradeName: group.tradeName,
      costCode: group.costCode,
      csiCode: group.csiCode,
      scopeItems: group.items.map((item) => ({
        description: item.description,
        inclusion: item.inclusion,
        specSection: item.specSection ?? null,
        drawingRef: item.drawingRef ?? null,
        notes: item.notes ?? null,
        riskFlag: item.riskFlag,
        // `restricted` is intentionally NOT included here
      })),
    });
  }

  const scopeItemCount = trades.reduce((n, t) => n + t.scopeItems.length, 0);

  const payload: AiSafePayload = {
    exportMetadata: {
      exportId: randomUUID(),
      generatedAt: new Date().toISOString(),
      bidPackageName: bid.projectName,
      projectType: bid.description ?? null,
      tradeCount: trades.filter((t) => t.tradeName !== "Unassigned").length,
      scopeItemCount,
      restrictedItemsStripped: restrictedCount,
    },
    trades,
  };

  // Second-pass safety check — throws on violation
  assertNoRestrictedItems(payload);

  return { payload, restrictedCount };
}
