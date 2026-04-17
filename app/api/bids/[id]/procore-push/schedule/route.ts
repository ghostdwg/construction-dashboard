// GET  /api/bids/[id]/procore-push/schedule
//   Returns the schedule as an MSP XML file for offline import into
//   Microsoft Project or Procore's manual schedule import wizard.
//   Response: application/xml attachment.
//
// POST /api/bids/[id]/procore-push/schedule
//   Pushes the schedule to Procore via the schedule import API.
//   Requires bid.procoreProjectId to be set.
//   Procore processes the import asynchronously.
//   Response: { ok: true, importId, status, activityCount, scheduleName }

import { prisma } from "@/lib/prisma";
import { buildMspXml } from "@/lib/services/schedule/mspXmlExport";
import { pushScheduleToProcore } from "@/lib/services/procore/scheduleService";
import { ProcoreError } from "@/lib/services/procore/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  try {
    const { xml, scheduleName } = await buildMspXml(bidId);
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = scheduleName.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    const fileName = `Schedule_${safeName}_${dateStr}.xml`;

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, procoreProjectId: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });
  if (!bid.procoreProjectId) {
    return Response.json(
      { error: "No Procore project linked to this bid. Link one in the Procore tab." },
      { status: 400 }
    );
  }

  try {
    const result = await pushScheduleToProcore(bidId, bid.procoreProjectId);
    return Response.json(result);
  } catch (err) {
    const message =
      err instanceof ProcoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
