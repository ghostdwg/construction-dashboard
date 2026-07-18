// PATCH /api/bids/[id]/meetings/[meetingId]/participants/[participantId]
//   Update participant name/role/company. Used when resolving speaker
//   labels (SPEAKER_A → "John Smith, GC PM") after transcription.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { meetingHasDurableHistory } from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";

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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

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

  const outcome = await prisma.$transaction(async (tx) => {
    const participant = await tx.meetingParticipant.findFirst({
      where: { id: pId, meetingId: mId, meeting: { bidId } },
      select: { id: true },
    });
    if (!participant) return { kind: "not-found" as const };
    if (body.name !== undefined && (await meetingHasDurableHistory(tx, mId, bidId))) {
      return { kind: "conflict" as const };
    }
    await tx.meetingParticipant.update({ where: { id: pId }, data });
    const audit = await writeRegisterAuditTx(tx, {
      action: "meeting.participant_updated",
      decision: "committed",
      subjectKind: "MeetingParticipant",
      subjectId: pId,
      actor: access.user,
      payload: { bidId, meetingId: mId, changedFields: Object.keys(data).sort() },
    });
    return { kind: "committed" as const, audit };
  });
  if (outcome.kind === "not-found") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "conflict") {
    return Response.json(
      { error: "Speaker names are locked after materialization. Use audited segment corrections." },
      { status: 409 },
    );
  }
  emitRegisterAuditPostCommit(outcome.audit);
  return Response.json({ ok: true });
}
