import { prisma } from "@/lib/prisma";

export const DURABLE_HISTORY_CONFLICT =
  "Deletion would remove permanent Meeting Register history. Archive the project instead.";
export const FROZEN_TRANSCRIPT_CONFLICT =
  "Transcript source is locked after materialization or analysis. Use audited segment corrections.";
export const SOURCE_MUTATION_IN_PROGRESS_CONFLICT =
  "Meeting media source mutation is in progress. Retry after transcription reaches a terminal state.";
export const MEETING_OWNERSHIP_CONTENTION_CONFLICT =
  "Meeting source ownership is busy. Retry the request.";
export const ACTIVE_SOURCE_MUTATION_STATUSES = ["UPLOADING", "TRANSCRIBING"] as const;

const SQLITE_CONTENTION_ATTEMPTS = 4;
const SQLITE_CONTENTION_BACKOFF_MS = 100;

type DeleteResult =
  | { ok: true; audioStorageKey?: string | null; audioFileName?: string | null }
  | { ok: false; status: 404 | 409; error: string };

type DurableHistoryDb = Pick<
  typeof prisma,
  | "meetingTranscriptSegment"
  | "meetingTranscriptCorrection"
  | "meetingRegisterEntry"
  | "meetingRegisterEntryRevision"
  | "meetingExtractionRun"
  | "meetingMinutesRevision"
  | "meetingIntelligenceArtifact"
  | "meetingIntelligenceSegment"
  | "meetingIntelligenceCandidate"
  | "meetingIntelligenceWorkerJob"
>;

type TranscriptGateDb = DurableHistoryDb & Pick<typeof prisma, "meeting">;
type HistoryMaterializationDb = Pick<typeof prisma, "meeting">;
type MeetingRegisterTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type TranscriptMutationGate =
  | { ok: true }
  | { ok: false; reason: "not-found" | "frozen" };

export type TranscriptMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not-found" | "frozen" | "contention" };
export type ActiveTranscriptMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not-found" | "state-conflict" | "contention" };
export type HistoryMaterializationGate = { ok: true } | { ok: false; reason: "not-found" | "source-mutation" };
export type HistoryMaterializationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not-found" | "source-mutation" | "contention" };

class TranscriptGateRejected extends Error {
  constructor(readonly reason: "not-found" | "frozen") {
    super(reason);
  }
}

function isSqliteContentionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "P1008" || candidate.code === "P2034") return true;
  return (
    typeof candidate.message === "string" &&
    /SQLITE_BUSY|database is locked|database table is locked/i.test(candidate.message)
  );
}

async function contentionBackoff(attempt: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, SQLITE_CONTENTION_BACKOFF_MS * attempt);
  });
}

/**
 * Retry only Prisma/SQLite lock-contention failures. All other database
 * errors retain their original type and stack. Exhaustion is an explicit
 * ownership conflict; the owning transaction has rolled back, so no partial
 * source/history mutation can survive.
 */
async function withOwnershipRetry<T>(
  operation: () => Promise<T>,
  conflict: () => T,
): Promise<T> {
  for (let attempt = 1; attempt <= SQLITE_CONTENTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteContentionError(error)) throw error;
      if (attempt === SQLITE_CONTENTION_ATTEMPTS) {
        console.warn(
          `[meeting-ownership] SQLite contention persisted after ${attempt} attempts`,
        );
        return conflict();
      }
      await contentionBackoff(attempt);
    }
  }
  return conflict();
}

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
    db.meetingIntelligenceArtifact.count({ where: { meetingId, bidId } }),
    db.meetingIntelligenceSegment.count({ where: { meetingId, bidId } }),
    db.meetingIntelligenceCandidate.count({ where: { meetingId, bidId } }),
    db.meetingIntelligenceWorkerJob.count({ where: { meetingId, bidId } }),
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
 * Acquires the Meeting row as the serialization point for a durable-history
 * transaction. SQLite serializes this write with the upload's PENDING/FAILED
 * -> UPLOADING claim. Whichever transaction wins makes the other observe
 * either durable history or an active source-mutation status.
 *
 * Call this inside the same transaction, before creating any of the five
 * freeze-trigger rows. The updatedAt touch is intentional: a read-only status
 * check would permit write skew on databases that do not lock reads.
 */
export async function meetingHistoryMaterializationGate(
  db: HistoryMaterializationDb,
  meetingId: number,
  bidId: number,
): Promise<HistoryMaterializationGate> {
  const claim = await db.meeting.updateMany({
    where: {
      id: meetingId,
      bidId,
      status: { notIn: [...ACTIVE_SOURCE_MUTATION_STATUSES] },
    },
    data: { updatedAt: new Date() },
  });
  if (claim.count === 1) return { ok: true };
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true },
  });
  return meeting
    ? { ok: false, reason: "source-mutation" }
    : { ok: false, reason: "not-found" };
}

export function historyMaterializationError(
  reason: "not-found" | "source-mutation" | "contention",
): string {
  return reason === "not-found"
    ? "Not found"
    : reason === "contention"
      ? MEETING_OWNERSHIP_CONTENTION_CONFLICT
      : SOURCE_MUTATION_IN_PROGRESS_CONFLICT;
}

export async function withMeetingHistoryMaterialization<T>(
  bidId: number,
  meetingId: number,
  materialize: (tx: MeetingRegisterTx) => Promise<T>,
): Promise<HistoryMaterializationResult<T>> {
  return withOwnershipRetry<HistoryMaterializationResult<T>>(
    () =>
      prisma.$transaction(async (tx) => {
        const gate = await meetingHistoryMaterializationGate(tx, meetingId, bidId);
        if (!gate.ok) return gate;
        return { ok: true as const, value: await materialize(tx) };
      }),
    () => ({ ok: false as const, reason: "contention" as const }),
  );
}

/**
 * Continue a source mutation only while this request still owns the expected
 * lifecycle state. Unlike withMutableMeetingTranscript, this deliberately
 * does not re-run the freeze gate: history writers are excluded by
 * meetingHistoryMaterializationGate for the entire active interval.
 */
export async function withActiveMeetingTranscriptMutation<T>(
  bidId: number,
  meetingId: number,
  expectedStatus: (typeof ACTIVE_SOURCE_MUTATION_STATUSES)[number],
  mutate: (tx: MeetingRegisterTx) => Promise<T>,
): Promise<ActiveTranscriptMutationResult<T>> {
  return withOwnershipRetry<ActiveTranscriptMutationResult<T>>(
    () =>
      prisma.$transaction(async (tx) => {
        const claim = await tx.meeting.updateMany({
          where: { id: meetingId, bidId, status: expectedStatus },
          data: { updatedAt: new Date() },
        });
        if (claim.count !== 1) {
          const meeting = await tx.meeting.findFirst({
            where: { id: meetingId, bidId },
            select: { id: true },
          });
          return meeting
            ? { ok: false as const, reason: "state-conflict" as const }
            : { ok: false as const, reason: "not-found" as const };
        }
        return { ok: true as const, value: await mutate(tx) };
      }),
    () => ({ ok: false as const, reason: "contention" as const }),
  );
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
  try {
    return await withOwnershipRetry<TranscriptMutationResult<T>>(
      () =>
        prisma.$transaction(async (tx) => {
          // Acquire SQLite's write serialization point before reading history.
          // A read-first interactive transaction can deadlock a concurrent
          // history writer at commit (reader waits on writer while writer waits
          // on reader). The touch is rolled back when the freeze gate rejects.
          const claim = await tx.meeting.updateMany({
            where: { id: meetingId, bidId },
            data: { updatedAt: new Date() },
          });
          if (claim.count !== 1) throw new TranscriptGateRejected("not-found");
          if (await meetingHasDurableHistory(tx, meetingId, bidId)) {
            throw new TranscriptGateRejected("frozen");
          }
          return { ok: true as const, value: await mutate(tx) };
        }),
      () => ({ ok: false as const, reason: "contention" as const }),
    );
  } catch (error) {
    if (error instanceof TranscriptGateRejected) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
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
    db.meetingIntelligenceArtifact.count({ where: { bidId } }),
    db.meetingIntelligenceSegment.count({ where: { bidId } }),
    db.meetingIntelligenceCandidate.count({ where: { bidId } }),
    db.meetingIntelligenceWorkerJob.count({ where: { bidId } }),
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
      select: { id: true, audioStorageKey: true, audioFileName: true },
    });
    if (!meeting) return { ok: false, status: 404, error: "Not found" };
    if (await meetingHasDurableHistory(tx, meetingId, bidId)) {
      return { ok: false, status: 409, error: DURABLE_HISTORY_CONFLICT };
    }
    await tx.meeting.delete({ where: { id: meetingId } });
    return {
      ok: true,
      audioStorageKey: meeting.audioStorageKey,
      audioFileName: meeting.audioFileName,
    };
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
