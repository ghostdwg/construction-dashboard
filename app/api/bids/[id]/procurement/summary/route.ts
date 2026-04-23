// GET /api/bids/[id]/procurement/summary
//
// Returns package-level procurement control summary for the command surface.
//
// Response shape:
//   {
//     totalPackages, blocked, atRisk, readyForExport, unlinked,
//     overdueItems,           — items where submitByDate < today and not approved
//     nearestSubmitByDate,    — ISO string of the soonest upcoming submitByDate
//     packages: [{ id, packageNumber, name, riskStatus, readyForExport, linkedActivityId, itemCount, openItemCount }]
//   }

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const CLOSED = new Set(["APPROVED", "APPROVED_AS_NOTED"]);

  const packages = await prisma.submittalPackage.findMany({
    where: { bidId },
    orderBy: { packageNumber: "asc" },
    select: {
      id: true,
      packageNumber: true,
      name: true,
      riskStatus: true,
      readyForExport: true,
      linkedActivityId: true,
      items: {
        select: {
          id: true,
          status: true,
          submitByDate: true,
        },
      },
    },
  });

  const CLOSED_STATUSES = ["APPROVED", "APPROVED_AS_NOTED"];

  let overdueItems = 0;
  let nearestSubmitByDate: Date | null = null;

  const packageRows = packages.map((pkg) => {
    const openItems = pkg.items.filter((i) => !CLOSED.has(i.status));
    for (const item of openItems) {
      if (!item.submitByDate) continue;
      const sbd = new Date(item.submitByDate);
      if (sbd < today) {
        overdueItems++;
      } else {
        if (!nearestSubmitByDate || sbd < nearestSubmitByDate) nearestSubmitByDate = sbd;
      }
    }
    return {
      id: pkg.id,
      packageNumber: pkg.packageNumber,
      name: pkg.name,
      riskStatus: pkg.riskStatus,
      readyForExport: pkg.readyForExport,
      linkedActivityId: pkg.linkedActivityId,
      itemCount: pkg.items.length,
      openItemCount: openItems.length,
    };
  });

  return Response.json({
    totalPackages: packages.length,
    blocked: packages.filter((p) => p.riskStatus === "BLOCKED").length,
    atRisk: packages.filter((p) => p.riskStatus === "AT_RISK").length,
    readyForExport: packages.filter((p) => p.readyForExport).length,
    unlinked: packages.filter((p) => !p.linkedActivityId).length,
    overdueItems,
    nearestSubmitByDate: nearestSubmitByDate ? (nearestSubmitByDate as Date).toISOString() : null,
    packages: packageRows,
  });
}
