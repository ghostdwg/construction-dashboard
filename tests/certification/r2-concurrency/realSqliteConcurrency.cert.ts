/**
 * R2 real-SQLite concurrency certification — 11 cases.
 *
 * This file is a COMMITTED, VERBATIM-BEHAVIOUR copy of the disposable
 * `lib/services/meetingRegister/__tests__/realSqliteConcurrency.test.ts` harness
 * that produced the "11/11 real-SQLite cases passed" evidence during the R2
 * targeted-blocker repair and final-candidate-convergence sessions
 * (evidence: /tmp/.../targeted-real-sqlite-isolated.txt, SHA256 6e12a753…).
 *
 * It is intentionally NOT named as a `.test.ts` file, so it is invisible to
 * this repository's own Vitest discovery (which only collects files ending in
 * dot-test-dot-ts). The certification runner (`certify.mjs`) copies it INTO a
 * disposable, exact candidate reconstruction (fingerprint 1514fd2a…), renamed
 * to a `.cert.test.ts` file, where the repaired product code under test
 * actually exists, and runs each case in its own process against a fresh
 * file-backed SQLite database.
 *
 * Product imports use the `@/` alias so the file resolves from any location
 * inside the candidate. Plan A strengthens three proofs: simultaneous
 * active-slot reservation, observable failJob retry entry, and ordered
 * persisted upload audits. The other committed cases remain unchanged.
 *
 * Do not point this at a real DATABASE_URL. It only ever runs against a
 * disposable `file:` SQLite database created under /tmp by the runner.
 */
import { promises as fs } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({
    ok: true,
    user: { id: "sqlite-test-operator", role: "admin" },
  })),
}));

import {
  meetingHistoryMaterializationGate,
  withActiveMeetingTranscriptMutation,
  withMeetingHistoryMaterialization,
  withMutableMeetingTranscript,
} from "@/lib/services/meetingRegister/retention";
import {
  createJob,
  failJob,
  startJob,
} from "@/lib/services/jobs/backgroundJobService";
import { POST as uploadPOST } from "@/app/api/bids/[id]/meetings/[meetingId]/upload/route";
import { POST as analyzePOST } from "@/app/api/bids/[id]/meetings/[meetingId]/analyze/route";

const databaseUrl = process.env.DATABASE_URL!;
const storageRoot = process.env.STORAGE_LOCAL_PATH!;
const barrierWorkerPath = join(dirname(fileURLToPath(import.meta.url)), "sqliteBarrierWorker.ts");

function client() {
  return new PrismaClient({ adapter: new PrismaLibSql({ url: databaseUrl }) });
}

type Db = ReturnType<typeof client>;
type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const liveWorkers = new Set<ChildProcess>();

async function startJobLockWorker(jobId: string) {
  const child = fork(barrierWorkerPath, [jobId], {
    cwd: process.cwd(),
    env: process.env,
    execArgv: ["--import", "tsx"],
    silent: true,
  });
  liveWorkers.add(child);

  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  let completeResolve!: () => void;
  let completeReject!: (error: Error) => void;
  const complete = new Promise<void>((resolve, reject) => {
    completeResolve = resolve;
    completeReject = reject;
  });
  void complete.catch(() => undefined);

  const locked = new Promise<void>((resolve, reject) => {
    let reached = false;
    child.on("message", (message: unknown) => {
      const event = message as { type?: string; message?: string };
      if (event.type === "locked") {
        reached = true;
        resolve();
      } else if (event.type === "complete") {
        liveWorkers.delete(child);
        completeResolve();
      } else if (event.type === "error") {
        const error = new Error(event.message ?? "job-lock worker failed");
        if (!reached) reject(error);
        completeReject(error);
      }
    });
    child.once("exit", (code) => {
      liveWorkers.delete(child);
      if (code !== 0) {
        const error = new Error(`job-lock worker exited ${code}: ${stderr}`);
        if (!reached) reject(error);
        completeReject(error);
      }
    });
  });

  await locked;
  return {
    release() { child.send("release"); },
    complete,
  };
}

async function captured<T>(promise: Promise<T>) {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    return {
      ok: false as const,
      error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

let a: Db;
let b: Db;
let c: Db;

async function fixture(status = "PENDING", transcript: string | null = null) {
  const bid = await a.bid.create({
    data: { projectName: `SQLite concurrency ${Date.now()}-${Math.random()}` },
  });
  const meeting = await a.meeting.create({
    data: {
      bidId: bid.id,
      title: "Disposable concurrency meeting",
      meetingDate: new Date("2026-07-18T12:00:00Z"),
      status,
      transcript,
    },
  });
  return { bidId: bid.id, meetingId: meeting.id };
}

async function historyCounts(db: Db, bidId: number, meetingId: number) {
  return Promise.all([
    db.meetingTranscriptSegment.count({ where: { bidId, meetingId } }),
    db.meetingTranscriptCorrection.count({ where: { bidId, meetingId } }),
    db.meetingRegisterEntry.count({ where: { bidId, meetingId } }),
    db.meetingExtractionRun.count({ where: { bidId, meetingId } }),
    db.meetingMinutesRevision.count({ where: { bidId, meetingId } }),
  ]);
}

beforeAll(() => {
  a = client();
  b = client();
  c = client();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const child of liveWorkers) {
    if (child.connected) child.send("release", () => undefined);
    child.kill();
  }
  liveWorkers.clear();
});

afterAll(async () => {
  await Promise.all([a.$disconnect(), b.$disconnect(), c.$disconnect()]);
});

describe("real SQLite source/history serialization", () => {
  it("history begins first, then a separate client source claim cannot partially mutate", async () => {
    const { bidId, meetingId } = await fixture();
    const held = deferred();
    const release = deferred();

    const history = a.$transaction(async (tx) => {
      const gate = await meetingHistoryMaterializationGate(tx, meetingId, bidId);
      expect(gate).toEqual({ ok: true });
      held.resolve();
      await release.promise;
      await tx.meetingRegisterEntry.create({
        data: {
          bidId,
          meetingId,
          entryType: "DISCUSSION",
          rawSourceText: "history winner",
          normalizedText: "history winner",
          origin: "manual",
          reviewState: "CONFIRMED",
        },
      });
    });

    await held.promise;
    const source = captured(withMutableMeetingTranscript(bidId, meetingId, async (tx) => {
      await tx.meeting.update({ where: { id: meetingId }, data: { status: "UPLOADING" } });
      return "source";
    }));
    setTimeout(release.resolve, 150);

    const [historyResult, sourceResult] = await Promise.all([captured(history), source]);
    const counts = await historyCounts(c, bidId, meetingId);
    const status = (await c.meeting.findUnique({ where: { id: meetingId } }))?.status;
    console.log("history-first outcomes", {
      history: historyResult.ok ? "committed" : historyResult.message,
      source: sourceResult.ok ? sourceResult.value : sourceResult.message,
      counts,
      status,
    });
    expect(status).toBe("PENDING");
    expect(counts).toEqual(historyResult.ok ? [0, 0, 1, 0, 0] : [0, 0, 0, 0, 0]);
    expect(sourceResult.ok).toBe(true);
    if (sourceResult.ok) {
      expect(sourceResult.value).toEqual({ ok: false, reason: "frozen" });
    }
    expect(historyResult.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await expect(
      withMutableMeetingTranscript(bidId, meetingId, async () => "must-not-run"),
    ).resolves.toEqual({ ok: false, reason: "frozen" });
  });

  it("upload wins first and all five protected history table attempts remain byte-empty", async () => {
    const { bidId, meetingId } = await fixture("UPLOADING");
    const writers: Array<(tx: Tx) => Promise<unknown>> = [
      (tx) => tx.meetingTranscriptSegment.create({ data: {
        bidId, meetingId, segmentIndex: 0, sortKey: 0,
        originalText: "segment", currentText: "segment",
      } }),
      (tx) => tx.meetingTranscriptCorrection.create({ data: {
        bidId, meetingId, correctionType: "EDIT_TEXT", correctedBy: "test",
      } }),
      (tx) => tx.meetingRegisterEntry.create({ data: {
        bidId, meetingId, entryType: "DISCUSSION", rawSourceText: "entry",
        normalizedText: "entry", origin: "manual", reviewState: "CONFIRMED",
      } }),
      (tx) => tx.meetingExtractionRun.create({ data: {
        bidId, meetingId, analysisVersion: 1, trigger: "INITIAL",
      } }),
      (tx) => tx.meetingMinutesRevision.create({ data: {
        bidId, meetingId, contentJson: "{}", publishedBy: "test",
      } }),
    ];

    for (const write of writers) {
      const result = await withMeetingHistoryMaterialization(bidId, meetingId, async (tx) => {
        await write(tx);
        return "history";
      });
      expect(result).toEqual({ ok: false, reason: "source-mutation" });
    }
    expect(await historyCounts(c, bidId, meetingId)).toEqual([0, 0, 0, 0, 0]);
  });

  it("concurrent source ownership claims produce at most one winner and no torn state", async () => {
    const { bidId, meetingId } = await fixture();
    const claim = (marker: string) => captured(withMutableMeetingTranscript(
      bidId,
      meetingId,
      async (tx) => {
        const count = await tx.meeting.updateMany({
        where: { id: meetingId, bidId, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "UPLOADING", audioFileName: marker },
        });
        return count.count;
      },
    ));
    const outcomes = await Promise.all([claim("a.wav"), claim("b.wav")]);
    console.log("concurrent source claim outcomes", outcomes.map((o) => o.ok ? o.value : o.message));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(
      outcomes.filter((outcome) => outcome.ok && outcome.value.ok && outcome.value.value === 1),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.ok && outcome.value.ok && outcome.value.value === 0),
    ).toHaveLength(1);
    expect((await c.meeting.findUnique({ where: { id: meetingId } }))?.status).toBe("UPLOADING");
    expect(await historyCounts(c, bidId, meetingId)).toEqual([0, 0, 0, 0, 0]);
  });

  it("records the separate-client SQLite busy/timeout behavior without partial commit", async () => {
    const { bidId, meetingId } = await fixture();
    const locked = deferred();
    const release = deferred();
    const holder = a.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id: meetingId }, data: { audioFileName: "holder.wav" } });
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const started = Date.now();
    const contender = captured(b.meeting.update({
      where: { id: meetingId }, data: { audioStorageKey: "contender.wav" },
    }));
    setTimeout(release.resolve, 200);
    const [holderResult, contenderResult] = await Promise.all([captured(holder), contender]);
    const elapsedMs = Date.now() - started;
    console.log("sqlite busy outcome", {
      elapsedMs,
      result: contenderResult.ok ? "waited-and-committed" : contenderResult.message,
    });
    expect(holderResult.ok).toBe(true);
    const row = await c.meeting.findUnique({ where: { id: meetingId } });
    expect(row?.audioFileName).toBe("holder.wav");
    if (contenderResult.ok) expect(row?.audioStorageKey).toBe("contender.wav");
    else {
      expect(contenderResult.message).toMatch(/busy|locked|transaction/i);
      expect(row?.audioStorageKey).toBeNull();
    }
    expect(await historyCounts(c, bidId, meetingId)).toEqual([0, 0, 0, 0, 0]);
  });

  it("losing ownership before commit yields state-conflict and leaves the source pointer unchanged", async () => {
    const { bidId, meetingId } = await fixture("UPLOADING");
    await b.meeting.update({ where: { id: meetingId }, data: { status: "READY" } });
    const result = await withActiveMeetingTranscriptMutation(
      bidId,
      meetingId,
      "UPLOADING",
      (tx) => tx.meeting.update({
        where: { id: meetingId }, data: { audioStorageKey: "must-not-commit.wav" },
      }),
    );
    expect(result).toEqual({ ok: false, reason: "state-conflict" });
    expect((await c.meeting.findUnique({ where: { id: meetingId } }))?.audioStorageKey).toBeNull();
  });
});

describe("real SQLite BackgroundJob and runtime reconciliation", () => {
  it("enforces duplicate active-slot reservation and allows a new slot after failure", async () => {
    const { bidId } = await fixture();
    const start = deferred();
    const bothArmed = deferred();
    let armed = 0;
    const reserve = async () => {
      armed += 1;
      if (armed === 2) bothArmed.resolve();
      await start.promise;
      return captured(createJob({ jobType: "meeting_transcription", bidId }));
    };
    const reservations = [reserve(), reserve()];
    await bothArmed.promise;
    expect(armed).toBe(2);
    start.resolve();
    const outcomes = await Promise.all(reservations);
    const winners = outcomes.filter((outcome) => outcome.ok);
    const losers = outcomes.filter((outcome) => !outcome.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const first = winners[0].ok ? winners[0].value : null;
    const loser = losers[0];
    expect(first).not.toBeNull();
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      const code = (loser.error as { code?: unknown } | null)?.code;
      expect(code === "P2002" || /unique|active.?slot/i.test(loser.message)).toBe(true);
    }
    if (!first) throw new Error("active-slot reservation had no winner");
    await failJob(first.id, "synthetic failure");
    const retry = await createJob({ jobType: "meeting_transcription", bidId });
    expect(retry.id).not.toBe(first.id);
    expect(await c.backgroundJob.findMany({
      where: { bidId, jobType: "meeting_transcription" },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, activeSlot: true },
    })).toEqual([
      { id: first.id, status: "failed", activeSlot: null },
      { id: retry.id, status: "queued", activeSlot: 1 },
    ]);
  });

  it("injects failJob contention and proves durable idempotent slot release", async () => {
    const { bidId } = await fixture();
    const job = await createJob({ jobType: "meeting_transcription", bidId });
    const holder = await startJobLockWorker(job.id);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const failed = captured(failJob(job.id, "injected failJob", "provider-injected"));

    for (let turn = 0; turn < 100 && vi.getTimerCount() === 0; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(vi.getTimerCount()).toBe(1);
    holder.release();
    await holder.complete;
    await vi.runOnlyPendingTimersAsync();
    const outcome = await failed;
    vi.useRealTimers();
    console.log("failJob contention outcome", outcome.ok ? "committed" : outcome.message);
    const row = await c.backgroundJob.findUnique({ where: { id: job.id } });
    expect(outcome.ok).toBe(true);
    expect(row).toMatchObject({ status: "failed", activeSlot: null, externalJobId: "provider-injected" });
    await failJob(job.id, "injected failJob", "provider-injected");
    expect(await c.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "failed", activeSlot: null, externalJobId: "provider-injected",
    });
  });

  it("reconciles provider id and releases active slot after ownership loss", async () => {
    const { bidId, meetingId } = await fixture("UPLOADING");
    const job = await createJob({ jobType: "meeting_transcription", bidId, relatedId: String(meetingId) });
    await b.meeting.update({ where: { id: meetingId }, data: { status: "READY" } });
    const arm = await withActiveMeetingTranscriptMutation(
      bidId, meetingId, "UPLOADING",
      (tx) => tx.meeting.update({ where: { id: meetingId }, data: {
        status: "TRANSCRIBING", transcriptionJobId: "provider-should-not-arm",
      } }),
    );
    expect(arm).toEqual({ ok: false, reason: "state-conflict" });
    await failJob(job.id, "ownership lost", "provider-after-loss");
    expect(await c.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "failed", activeSlot: null, externalJobId: "provider-after-loss",
    });
  });

  it("the real upload route returns 503 before provider egress when durable reservation fails", async () => {
    const { bidId, meetingId } = await fixture();
    await createJob({ jobType: "meeting_transcription", bidId, relatedId: "existing" });
    const oldKey = `uploads/meetings/${meetingId}/old-referenced.wav`;
    const oldPath = join(storageRoot, oldKey);
    await fs.mkdir(join(storageRoot, `uploads/meetings/${meetingId}`), { recursive: true });
    await fs.writeFile(oldPath, Buffer.from("prior referenced bytes"));
    await a.meeting.update({ where: { id: meetingId }, data: { audioStorageKey: oldKey } });

    const form = new FormData();
    form.set("audio", new File(["new bytes"], "retry.wav", { type: "audio/wav" }));
    const response = await uploadPOST(
      new Request("http://local/upload", { method: "POST", body: form }),
      { params: Promise.resolve({ id: String(bidId), meetingId: String(meetingId) }) },
    );
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(await fs.readFile(oldPath, "utf8")).toBe("prior referenced bytes");
    expect((await c.meeting.findUnique({ where: { id: meetingId } }))?.status).toBe("FAILED");
    expect(await fs.readdir(join(storageRoot, `uploads/meetings/${meetingId}`))).toEqual([
      "old-referenced.wav",
    ]);
    expect(await c.auditEvent.findMany({
      where: { subjectKind: "Meeting", subjectId: String(meetingId) },
      orderBy: { emittedAt: "asc" },
      select: { action: true, decision: true, payloadJson: true },
    })).toEqual([
      expect.objectContaining({
        action: "meeting.transcription_upload_started",
        decision: "committed",
      }),
      expect.objectContaining({
        action: "meeting.transcription_failed",
        decision: "committed",
        payloadJson: expect.stringContaining('"failureClass":"job-tracking"'),
      }),
    ]);
    const failedAudit = await c.auditEvent.findFirstOrThrow({
      where: {
        subjectKind: "Meeting",
        subjectId: String(meetingId),
        action: "meeting.transcription_failed",
      },
      select: { payloadJson: true },
    });
    expect(failedAudit.payloadJson).toContain('"blobCleanupFailed":false');
  });

  it("analysis ownership failure returns 409 before provider egress on the real database", async () => {
    const { bidId, meetingId } = await fixture("UPLOADING", "[00:00:01] GC: confidential transcript");
    const response = await analyzePOST(
      new Request("http://local/analyze", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: String(bidId), meetingId: String(meetingId) }) },
    );
    expect(response.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect((await c.meeting.findUnique({ where: { id: meetingId } }))?.status).toBe("UPLOADING");
  });

  it("successful provider linkage and terminal reconciliation preserve provider ids", async () => {
    const { bidId } = await fixture();
    const running = await createJob({ jobType: "meeting_transcription", bidId });
    await startJob(running.id, "provider-running");
    expect(await c.backgroundJob.findUnique({ where: { id: running.id } })).toMatchObject({
      status: "running", activeSlot: 1, externalJobId: "provider-running",
    });
    await failJob(running.id, "reconciliation failure", "provider-running");
    expect(await c.backgroundJob.findUnique({ where: { id: running.id } })).toMatchObject({
      status: "failed", activeSlot: null, externalJobId: "provider-running",
    });
  });
});
