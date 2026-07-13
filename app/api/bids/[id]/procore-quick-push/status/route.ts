// GET /api/bids/[id]/procore-quick-push/status
//
// Returns readiness information for the Quick Push button:
//   bidStatus, procoreProjectId, credsOk, counts
//
// Used by QuickPushButton to render the pre-flight card and decide
// button state before the user initiates a push.

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProcoreCreds } from "@/lib/services/procore/client";

const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!AUTH_DISABLED) {
    const session = await auth();
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      id: true,
      status: true,
      procoreProjectId: true,
      budgetGcLines: true,
    },
  });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });

  let credsOk = false;
  try {
    await getProcoreCreds();
    credsOk = true;
  } catch {
    // no-op — credsOk stays false
  }

  const [vendorCount, submittalCount, scheduleCount, tradeCount] =
    await Promise.all([
      prisma.subcontractor.count({
        where: {
          OR: [
            { selections: { some: { bidId } } },
            { buyoutItems: { some: { bidId } } },
          ],
        },
      }),
      prisma.submittalItem.count({ where: { bidId } }),
      prisma.scheduleActivity.count({ where: { bidId } }),
      prisma.bidTrade.count({ where: { bidId } }),
    ]);

  let gcLineCount = 0;
  try {
    const parsed = JSON.parse(bid.budgetGcLines ?? "[]");
    if (Array.isArray(parsed)) gcLineCount = parsed.length;
  } catch { /* ignore */ }

  return Response.json({
    bidStatus: bid.status,
    procoreProjectId: bid.procoreProjectId,
    credsOk,
    counts: {
      vendors: vendorCount,
      submittals: submittalCount,
      scheduleActivities: scheduleCount,
      budgetLines: tradeCount + gcLineCount,
    },
  });
}
