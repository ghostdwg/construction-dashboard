import '@/lib/env'
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import {
  assertResponseAccessTokenPatch,
  assertTradeResponseRevisionPatch,
} from "@/lib/services/tradeResponse/immutability";

// Phase 1B — ConsultantDispositionRecord is APPEND-ONLY at the client
// level. Prisma 7 removed $use middleware; the query extension below is
// its successor and rejects every mutation-of-history path on that model
// for EVERY caller of this shared client. The service layer additionally
// exports no update/delete function and the route answers 405 — this is
// the deepest of the three fences, not the only one.
const APPEND_ONLY_MESSAGE =
  "ConsultantDispositionRecord is append-only: corrections are made by appending a new record";

// R2-B1 — the meeting history models share the same discipline: transcript
// corrections and register-entry revisions are append-only; published
// minutes revisions are immutable once created (an amendment is a NEW
// revision row, never an edit).
const appendOnly = (message: string) => ({
  update: () => { throw new Error(message); },
  updateMany: () => { throw new Error(message); },
  upsert: () => { throw new Error(message); },
  delete: () => { throw new Error(message); },
  deleteMany: () => { throw new Error(message); },
});

function createPrisma() {
  const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter }).$extends({
    query: {
      consultantDispositionRecord: appendOnly(APPEND_ONLY_MESSAGE),
      meetingTranscriptCorrection: appendOnly(
        "MeetingTranscriptCorrection is append-only: a wrong correction is corrected by appending another correction"
      ),
      meetingRegisterEntryRevision: appendOnly(
        "MeetingRegisterEntryRevision is append-only: history is never rewritten"
      ),
      meetingMinutesRevision: appendOnly(
        "MeetingMinutesRevision is immutable: an amendment is a new revision, never an edit"
      ),
      tradeResponseRevision: {
        async update({ args, query }) {
          assertTradeResponseRevisionPatch(args.data as Record<string, unknown>);
          return query(args);
        },
        updateMany: () => {
          throw new Error("TradeResponseRevision response content is immutable: submit a new revision");
        },
        upsert: () => {
          throw new Error("TradeResponseRevision response content is immutable: submit a new revision");
        },
        delete: () => {
          throw new Error("TradeResponseRevision is append-only");
        },
        deleteMany: () => {
          throw new Error("TradeResponseRevision is append-only");
        },
      },
      responseAccessToken: {
        async update({ args, query }) {
          assertResponseAccessTokenPatch(args.data as Record<string, unknown>);
          return query(args);
        },
        async updateMany({ args, query }) {
          assertResponseAccessTokenPatch(args.data as Record<string, unknown>);
          return query(args);
        },
        upsert: () => {
          throw new Error("ResponseAccessToken credential scope is immutable: rotate or revoke the token");
        },
        delete: () => {
          throw new Error("ResponseAccessToken history is retained; revoke the token");
        },
        deleteMany: () => {
          throw new Error("ResponseAccessToken history is retained; revoke the token");
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrisma>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
