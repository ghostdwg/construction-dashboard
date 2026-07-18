// R2 auth/durability regression pack — shared in-memory Prisma test double.
//
// Independent of lib/services/meetingRegister/__tests__/mockDb.ts (owned by
// the R2-B1/SOL lanes) but follows the SAME repo idiom byte-for-byte: a
// Row[]-backed table with findFirst/findUnique/findMany/count/create/update/
// updateMany/deleteMany, unique-constraint emulation (P2002), and a
// $transaction with real snapshot/rollback semantics so atomicity tests
// exercise genuine transactional behavior against the fixture, not just a
// function's return value.
//
// This builder's table set spans every domain this regression pack touches
// (Meeting Register, Tracked Items, Field Reports, Consultant Reports/
// Observations) so a single import covers cross-domain scenarios (e.g.
// promotion + tenant isolation + audit) without juggling multiple mocks.
// Not a test file itself (vitest include is *.test.ts).

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      const ors = cond as Where[];
      if (ors.length === 0) continue;
      if (!ors.some((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown; gt?: unknown; notIn?: unknown[] };
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
      if ("not" in c) {
        if (c.not === null ? value === null : value === c.not) return false;
      }
      if ("gt" in c && !(typeof value === "number" && value > (c.gt as number))) return false;
    } else if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Array<Record<string, unknown>>;
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [field, dirRaw] = Object.entries(clause)[0];
      if (typeof dirRaw !== "string") continue;
      const dir = dirRaw === "desc" ? -1 : 1;
      const av = a[field] as number | string | Date | null;
      const bv = b[field] as number | string | Date | null;
      if (av === bv) continue;
      if (av == null) return -1 * dir;
      if (bv == null) return 1 * dir;
      return (av < bv ? -1 : 1) * dir;
    }
    return 0;
  });
}

export type Table = {
  rows: Row[];
  findFirst: (args?: { where?: Where; orderBy?: unknown; select?: unknown }) => Promise<Row | null>;
  findUnique: (args: { where: Where; select?: unknown }) => Promise<Row | null>;
  findMany: (args?: { where?: Where; orderBy?: unknown; select?: unknown; include?: unknown; take?: number }) => Promise<Row[]>;
  count: (args?: { where?: Where }) => Promise<number>;
  create: (args: { data: Row; select?: unknown }) => Promise<Row>;
  update: (args: { where: Where; data: Row }) => Promise<Row>;
  updateMany: (args: { where?: Where; data: Row }) => Promise<{ count: number }>;
  deleteMany: (args: { where?: Where }) => Promise<{ count: number }>;
};

export function makeTable(opts: { unique?: string[][]; defaults?: Row } = {}): Table {
  const rows: Row[] = [];
  let nextId = 1;
  const applyUpdateData = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) {
        row[k] = (row[k] as number) + ((v as Row).increment as number);
      } else {
        row[k] = v;
      }
    }
    row.updatedAt = new Date();
  };
  const copy = (r: Row): Row => ({ ...r });
  return {
    rows,
    findFirst: async (args = {}) => {
      const hit = sortRows(rows.filter((r) => matches(r, args.where)), args.orderBy)[0];
      return hit ? copy(hit) : null;
    },
    findUnique: async (args) => {
      const hit = rows.find((r) => matches(r, args.where));
      return hit ? copy(hit) : null;
    },
    findMany: async (args = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, args.where)), args.orderBy);
      if (args.take) out = out.slice(0, args.take);
      return out.map(copy);
    },
    count: async (args = {}) => rows.filter((r) => matches(r, args.where)).length,
    create: async (args) => {
      for (const cols of opts.unique ?? []) {
        const clash = rows.find((r) =>
          cols.every((c) => args.data[c] != null && r[c] === args.data[c])
        );
        if (clash) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
      }
      const row: Row = {
        id: nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(opts.defaults ?? {}),
        ...args.data,
      };
      rows.push(row);
      return copy(row);
    },
    update: async (args) => {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw new Error("Record not found");
      applyUpdateData(row, args.data);
      return copy(row);
    },
    updateMany: async (args) => {
      const hits = rows.filter((r) => matches(r, args.where));
      for (const row of hits) applyUpdateData(row, args.data);
      return { count: hits.length };
    },
    deleteMany: async (args) => {
      const hits = rows.filter((r) => matches(r, args.where ?? {}));
      for (const hit of hits) rows.splice(rows.indexOf(hit), 1);
      return { count: hits.length };
    },
  };
}

export type MockPrisma = {
  bid: Table;
  meeting: Table;
  meetingParticipant: Table;
  meetingTranscriptSegment: Table;
  meetingTranscriptCorrection: Table;
  meetingRegisterEntry: Table;
  meetingRegisterEntryRevision: Table;
  meetingExtractionRun: Table;
  meetingActionItem: Table;
  trackedItem: Table;
  trackedItemComment: Table;
  trackedItemAttachment: Table;
  fieldReport: Table;
  consultantReport: Table;
  consultantReportRevision: Table;
  consultantObservation: Table;
  consultantDispositionRecord: Table;
  trade: Table;
  auditEvent: Table;
  /** Referenced by app/api/bids/[id]/tracked-items/route.ts's spec-gap-hint
   *  read — kept as an always-empty table so that route doesn't crash when
   *  exercised through this pack's counting-proxy tests. */
  specBook: Table;
  $transaction: <T>(fn: (tx: MockPrisma) => Promise<T>) => Promise<T>;
};

const TABLE_NAMES = [
  "bid",
  "meeting",
  "meetingParticipant",
  "meetingTranscriptSegment",
  "meetingTranscriptCorrection",
  "meetingRegisterEntry",
  "meetingRegisterEntryRevision",
  "meetingExtractionRun",
  "meetingActionItem",
  "trackedItem",
  "trackedItemComment",
  "trackedItemAttachment",
  "fieldReport",
  "consultantReport",
  "consultantReportRevision",
  "consultantObservation",
  "consultantDispositionRecord",
  "trade",
  "auditEvent",
  "specBook",
] as const;

export function buildPrisma(): MockPrisma {
  const prisma = {
    bid: makeTable({ defaults: { createdById: "user-owner" } }),
    meeting: makeTable(),
    meetingParticipant: makeTable(),
    meetingTranscriptSegment: makeTable({
      defaults: { isActive: true, isUnknownSpeaker: false, participantId: null, splitFromSegmentId: null },
    }),
    meetingTranscriptCorrection: makeTable({ defaults: { affectedSegmentCount: 0, affectedDerivedJson: "{}" } }),
    meetingRegisterEntry: makeTable({
      defaults: {
        reviewState: "PENDING",
        participantsJson: "[]",
        linkedTrackedItemId: null,
        linkedActionItemId: null,
        linkedCommitmentId: null,
        linkedDesignChangeId: null,
        mergedIntoEntryId: null,
        relatedPriorEntryId: null,
        segmentId: null,
        extractionRunId: null,
        dueDate: null,
        supersededByRunId: null,
        supersededByEntryId: null,
        supersededAt: null,
      },
    }),
    meetingRegisterEntryRevision: makeTable(),
    meetingExtractionRun: makeTable(),
    meetingActionItem: makeTable(),
    // Every promotable/duplicate-guarded source FK is @unique in the real
    // schema — each guarded independently (Prisma emulates one @@unique per
    // column here, matching prisma/schema.prisma lines 4003/4006/4007).
    trackedItem: makeTable({
      unique: [["sourceMeetingActionItemId"], ["sourceConsultantObservationId"], ["sourceMeetingRegisterEntryId"]],
      defaults: {
        status: "OPEN",
        priority: "MEDIUM",
        sourceKind: "manual",
        extractionMethod: "manual",
        citationVerified: false,
        pmReviewRequired: false,
      },
    }),
    trackedItemComment: makeTable(),
    trackedItemAttachment: makeTable(),
    fieldReport: makeTable({ defaults: { parseStatus: "UNPARSED" } }),
    consultantReport: makeTable({ defaults: { status: "ACTIVE" } }),
    // Content-addressed dedupe guard (prisma/schema.prisma: @@unique([bidId, checksum])).
    consultantReportRevision: makeTable({ unique: [["bidId", "checksum"]] }),
    consultantObservation: makeTable({
      defaults: { state: "ENTERED", registerItemId: null, spawnedItemId: null },
    }),
    consultantDispositionRecord: makeTable(),
    trade: makeTable(),
    auditEvent: makeTable(),
    specBook: makeTable(),
  } as Omit<MockPrisma, "$transaction">;
  return {
    ...prisma,
    // Interactive transaction WITH rollback: all table rows are snapshotted
    // before the callback and restored when it throws — atomicity tests
    // (mutation + history + audit commit together or not at all) exercise
    // real transactional behavior against the fixture, not just a return
    // value.
    $transaction: async (fn) => {
      const snapshots = new Map<string, Row[]>();
      for (const name of TABLE_NAMES) {
        snapshots.set(name, (prisma as Record<string, Table>)[name].rows.map((r) => ({ ...r })));
      }
      try {
        return await fn({ ...prisma, $transaction: null as never } as MockPrisma);
      } catch (err) {
        for (const name of TABLE_NAMES) {
          const table = (prisma as Record<string, Table>)[name];
          table.rows.splice(0, table.rows.length, ...(snapshots.get(name) ?? []));
        }
        throw err;
      }
    },
  };
}
