// PATCH /api/bids/[id]/meetings/[meetingId]/participants/[participantId]
//   Update participant name/role/company. Used when resolving speaker
//   labels (SPEAKER_A → "John Smith, GC PM") after transcription.

import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; participantId: string }> }
) {
  const { id, meetingId, participantId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  const pId = parseInt(participantId, 10);
  if (isNaN(bidId) || isNaN(mId) || isNaN(pId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  // Verify ownership via meeting → bid
  const participant = await prisma.meetingParticipant.findFirst({
    where: { id: pId, meetingId: mId, meeting: { bidId } },
    select: { id: true },
  });
  if (!participant) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    role?: string | null;
    company?: string | null;
    projectContactId?: number | null;
  };
  const data: Record<string, unknown> = {};

  if (body.name !== undefined && body.name.trim())
    data.name = body.name.trim();
  if (body.role !== undefined)
    data.role = body.role?.trim() || null;
  if (body.company !== undefined)
    data.company = body.company?.trim() || null;
  if (body.projectContactId !== undefined)
    data.projectContactId = body.projectContactId ?? null;

  await prisma.meetingParticipant.update({ where: { id: pId }, data });
  return Response.json({ ok: true });
}
