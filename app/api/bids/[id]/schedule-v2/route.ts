// GET  /api/bids/[id]/schedule-v2
//   Returns { schedule, activities, deps } for the bid's Schedule V2.
//   Returns 404 if no schedule exists yet (client should POST to create).
//
// POST /api/bids/[id]/schedule-v2
//   Creates the Schedule V2 record for this bid (idempotent — returns existing
//   if already present). Body: { startDate?: string }

import {
  getScheduleForBid,
  getOrCreateSchedule,
  loadScheduleById,
} from "@/lib/services/schedule/scheduleV2Service";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  try {
    const result = await getScheduleForBid(bidId);
    if (!result) return Response.json({ error: "No schedule found" }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    console.error("[GET schedule-v2]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  try {
    // Check bid exists
    const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
    if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

    let startDate: Date | undefined;
    try {
      const body = await request.json() as { startDate?: string };
      if (body.startDate) startDate = new Date(body.startDate);
    } catch { /* empty body is fine */ }

    // getOrCreateSchedule handles the startDate fallback to constructionStartDate or next Monday
    let scheduleId: string;
    if (startDate) {
      const existing = await prisma.schedule.findFirst({
        where: { bidId },
        select: { id: true },
      });
      if (existing) {
        scheduleId = existing.id;
      } else {
        const s = await prisma.schedule.create({
          data: { bidId, name: "Baseline Schedule", startDate },
        });
        scheduleId = s.id;
      }
    } else {
      scheduleId = await getOrCreateSchedule(bidId);
    }

    const result = await loadScheduleById(scheduleId);
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error("[POST schedule-v2]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
