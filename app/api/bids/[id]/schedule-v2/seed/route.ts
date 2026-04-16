// POST /api/bids/[id]/schedule-v2/seed
//   Seeds the schedule from the bid's trade list. Idempotent — skips trades
//   that already have an activity. Returns the full schedule after seeding.

import { seedScheduleV2, loadScheduleById, getOrCreateSchedule } from "@/lib/services/schedule/scheduleV2Service";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  try {
    const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
    if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

    const seedResult = await seedScheduleV2(bidId, force);
    const scheduleId = await getOrCreateSchedule(bidId);
    const loadResult = await loadScheduleById(scheduleId);

    return Response.json({ ...loadResult, seedResult });
  } catch (err) {
    console.error("[POST schedule-v2/seed]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
