import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import { runGapAnalysis } from "./runGapAnalysis";

// ----- POST Route handler -----

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  if (process.env.GAP_STUB_MODE !== "true") {
    const hasKey = !!(await getSetting("ANTHROPIC_API_KEY"));
    if (!hasKey) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY is not set — configure it in /settings → AI Configuration" },
        { status: 503 }
      );
    }
  }

  let tradeIdFilter: number | undefined;
  try {
    const body = await request.json().catch(() => ({})) as { tradeId?: string };
    if (body.tradeId) {
      const parsed = parseInt(body.tradeId, 10);
      if (!isNaN(parsed)) tradeIdFilter = parsed;
    }
  } catch {
    // no body — run all trades
  }

  try {
    const { totalFindings, tradesAnalyzed } = await runGapAnalysis(bidId, tradeIdFilter);
    return Response.json({ success: true, totalFindings, tradesAnalyzed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /gap-analysis/generate] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
