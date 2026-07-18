import { prisma } from "@/lib/prisma";

export const DURABLE_HISTORY_CONFLICT =
  "Deletion would remove permanent Meeting Register history. Archive the project instead.";
export const FROZEN_TRANSCRIPT_CONFLICT =
  "Transcript source is locked after materialization or analysis. Use audited segment corrections.";

type DeleteResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

type DurableHistoryDb = Pick<
  typeof prisma,
  | "meetingTranscriptSegment"
  | "meetingTranscriptCorrection"
  | "meetingRegisterEntry"
  | "meetingRegisterEntryRevision"
  | "meetingExtractionRun"
  | "meetingMinutesRevision"
>;

type TranscriptGateDb = DurableHistoryDb & Pick<typeof prisma, "meeting">;
type MeetingRegisterTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type TranscriptMutationGate =
  | { ok: true }
  | { ok: false; reason: "not-found" | "frozen" };

export type TranscriptMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not-found" | "frozen" };

export async function meetingHasDurableHistory(
  db: DurableHistoryDb,
  meetingId: number,
  bidId: number,
): Promise<boolean> {
  const counts = await Promise.all([
    db.meetingTranscriptSegment.count({ where: { meetingId, bidId } }),
    db.meetingTranscriptCorrection.count({ where: { meetingId, bidId } }),
    db.meetingRegisterEntry.count({ where: { meetingId, bidId } }),
    db.meetingExtractionRun.count({ where: { meetingId, bidId } }),
    db.meetingMinutesRevision.count({ where: { meetingId, bidId } }),
  ]);
  return counts.some((count) => count > 0);
}

/**
 * The single decision boundary for any operation that can arm transcription
 * or replace the whole transcript source. Call it before parsing an upload or
 * contacting a provider, then use withMutableMeetingTranscript for the actual
 * write so a concurrent materialization cannot bypass the freeze.
 */
export async function meetingTranscriptMutationGate(
  db: TranscriptGateDb,
  meetingId: number,
  bidId: number,
): Promise<TranscriptMutationGate> {
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true },
  });
  if (!meeting) return { ok: false, reason: "not-found" };
  if (await meetingHasDurableHistory(db, meetingId, bidId)) {
    return { ok: false, reason: "frozen" };
  }
  return { ok: true };
}

/**
 * Transactional counterpart to meetingTranscriptMutationGate. Every mutable
 * transcript-source writer uses this wrapper immediately around persistence.
 */
export async function withMutableMeetingTranscript<T>(
  bidId: number,
  meetingId: number,
  mutate: (tx: MeetingRegisterTx) => Promise<T>,
): Promise<TranscriptMutationResult<T>> {
  return prisma.$transaction(async (tx) => {
    const gate = await meetingTranscriptMutationGate(tx, meetingId, bidId);
    if (!gate.ok) return gate;
    return { ok: true as const, value: await mutate(tx) };
  });
}

export async function bidHasDurableHistory(
  db: DurableHistoryDb,
  bidId: number,
): Promise<boolean> {
  const counts = await Promise.all([
    db.meetingTranscriptSegment.count({ where: { bidId } }),
    db.meetingTranscriptCorrection.count({ where: { bidId } }),
    db.meetingRegisterEntry.count({ where: { bidId } }),
    db.meetingRegisterEntryRevision.count({ where: { bidId } }),
    db.meetingExtractionRun.count({ where: { bidId } }),
    db.meetingMinutesRevision.count({ where: { bidId } }),
  ]);
  return counts.some((count) => count > 0);
}

export async function deleteMeetingWithoutHistory(
  bidId: number,
  meetingId: number,
): Promise<DeleteResult> {
  return prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.findFirst({
      where: { id: meetingId, bidId },
      select: { id: true },
    });
    if (!meeting) return { ok: false, status: 404, error: "Not found" };
    if (await meetingHasDurableHistory(tx, meetingId, bidId)) {
      return { ok: false, status: 409, error: DURABLE_HISTORY_CONFLICT };
    }
    await tx.meeting.delete({ where: { id: meetingId } });
    return { ok: true };
  });
}

export async function deleteBidWithoutHistory(bidId: number): Promise<DeleteResult> {
  return prisma.$transaction(async (tx) => {
    const bid = await tx.bid.findUnique({ where: { id: bidId }, select: { id: true } });
    if (!bid) return { ok: false, status: 404, error: "Bid not found" };
    if (await bidHasDurableHistory(tx, bidId)) {
      return { ok: false, status: 409, error: DURABLE_HISTORY_CONFLICT };
    }
    await tx.bid.delete({ where: { id: bidId } });
    return { ok: true };
  });
}
