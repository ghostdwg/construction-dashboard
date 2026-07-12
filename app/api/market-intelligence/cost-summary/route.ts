// GET /api/market-intelligence/cost-summary
//
// Returns aggregate MarketSourceDoc.costUsd for the current calendar month (UTC).
// Also returns the MARKET_COST_CAP_USD threshold if configured.
// Used by SourcesPanel to show "Cost this month: $X.XX" and a warning banner.
//
// No auth required — data is aggregate cost only, no document content or keys.

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function GET() {
  try {
    const since = startOfMonthUtc();
    const [agg, capSetting] = await Promise.all([
      prisma.marketSourceDoc.aggregate({
        where: { scannedAt: { gte: since } },
        _sum: { costUsd: true },
      }),
      getSetting("MARKET_COST_CAP_USD"),
    ]);

    const monthCostUsd = agg._sum.costUsd ?? 0;
    const capUsd = capSetting ? parseFloat(capSetting) : null;

    return Response.json({
      monthCostUsd,
      capUsd: Number.isFinite(capUsd) ? capUsd : null,
      sinceUtc: since.toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
