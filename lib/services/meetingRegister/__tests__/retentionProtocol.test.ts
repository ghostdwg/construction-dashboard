import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrisma, type MockPrisma, type Table } from "./mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));

import {
  meetingHasDurableHistory,
  withActiveMeetingTranscriptMutation,
  withMeetingHistoryMaterialization,
  withMutableMeetingTranscript,
} from "../retention";

type TriggerName =
  | "meetingTranscriptSegment"
  | "meetingTranscriptCorrection"
  | "meetingRegisterEntry"
  | "meetingExtractionRun"
  | "meetingMinutesRevision";

const TRIGGERS: TriggerName[] = [
  "meetingTranscriptSegment",
  "meetingTranscriptCorrection",
  "meetingRegisterEntry",
  "meetingExtractionRun",
  "meetingMinutesRevision",
];

function durableBytes() {
  return TRIGGERS.map((name) =>
    JSON.stringify(state.prisma[name].rows, (_key, value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
  );
}

async function createTrigger(tx: MockPrisma, name: TriggerName, marker: string) {
  await (tx[name] as Table).create({
    data: { meetingId: 9, bidId: 1, marker },
  });
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({
    data: {
      id: 9,
      bidId: 1,
      status: "PENDING",
      reviewStatus: "DRAFT",
      rawTranscript: null,
      analyzedAt: null,
    },
  });
});

describe("durable writer source coverage", () => {
  it("keeps all five trigger creators behind the shared history owner", () => {
    const sources = [
      "segments.ts",
      "register.ts",
      "corrections.ts",
      "minutes.ts",
      "extractionRuns.ts",
    ].map((name) =>
      readFileSync(join(process.cwd(), "lib/services/meetingRegister", name), "utf8"),
    );

    expect(sources[0]).toContain("meetingHistoryMaterializationGate");
    for (const source of sources.slice(1)) {
      expect(source).toContain("withMeetingHistoryMaterialization");
    }
  });

  it("claims analysis ownership before any provider request", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/api/bids/[id]/meetings/[meetingId]/analyze/route.ts",
      ),
      "utf8",
    );
    const claim = source.indexOf("const analysisClaim = await withMeetingHistoryMaterialization");
    const provider = source.indexOf("fetch(`${SIDECAR_URL}/meetings/analyze`");
    expect(claim).toBeGreaterThan(0);
    expect(provider).toBeGreaterThan(claim);
  });
});

describe("meeting media source/history serialization", () => {
  it("retries bounded SQLite contention and never converts unrelated errors", async () => {
    const realTransaction = state.prisma.$transaction;
    let attempts = 0;
    state.prisma.$transaction = vi.fn(async (fn) => {
      attempts += 1;
      if (attempts < 3) {
        const busy = new Error("Operations timed out after 200ms") as Error & {
          code: string;
        };
        busy.code = "P1008";
        throw busy;
      }
      return realTransaction(fn);
    }) as MockPrisma["$transaction"];

    const recovered = await withMutableMeetingTranscript(1, 9, async () => "won");
    expect(recovered).toEqual({ ok: true, value: "won" });
    expect(attempts).toBe(3);

    const unrelated = new Error("unique constraint") as Error & { code: string };
    unrelated.code = "P2002";
    state.prisma.$transaction = vi.fn(async () => {
      throw unrelated;
    }) as MockPrisma["$transaction"];
    await expect(withMutableMeetingTranscript(1, 9, async () => "never")).rejects.toBe(
      unrelated,
    );
  });

  it("normalizes exhausted SQLite contention to an explicit retryable ownership result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.prisma.$transaction = vi.fn(async () => {
      const busy = new Error("SQLITE_BUSY: database is locked") as Error & {
        code: string;
      };
      busy.code = "P1008";
      throw busy;
    }) as MockPrisma["$transaction"];

    await expect(withMutableMeetingTranscript(1, 9, async () => "never")).resolves.toEqual({
      ok: false,
      reason: "contention",
    });
    await expect(withMeetingHistoryMaterialization(1, 9, async () => "never")).resolves.toEqual({
      ok: false,
      reason: "contention",
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("lets a durable-history transaction win before source claim", async () => {
    const history = withMeetingHistoryMaterialization(1, 9, async (tx) => {
      await createTrigger(tx as unknown as MockPrisma, "meetingRegisterEntry", "winner");
      return "history";
    });
    const upload = withMutableMeetingTranscript(1, 9, async (tx) => {
      await tx.meeting.update({ where: { id: 9 }, data: { status: "UPLOADING" } });
      return "upload";
    });

    const [historyResult, uploadResult] = await Promise.all([history, upload]);

    expect(historyResult).toEqual({ ok: true, value: "history" });
    expect(uploadResult).toEqual({ ok: false, reason: "frozen" });
    expect((await state.prisma.meeting.findUnique({ where: { id: 9 } }))?.status).toBe(
      "PENDING",
    );
    expect(
      await meetingHasDurableHistory(
        state.prisma as unknown as Parameters<typeof meetingHasDurableHistory>[0],
        9,
        1,
      ),
    ).toBe(true);
  });

  it("lets upload win after claim and blocks every freeze-trigger writer byte-identically", async () => {
    const source = await withMutableMeetingTranscript(1, 9, async (tx) => {
      await tx.meeting.update({ where: { id: 9 }, data: { status: "UPLOADING" } });
      return "claimed";
    });
    expect(source).toEqual({ ok: true, value: "claimed" });

    const before = durableBytes();
    for (const name of TRIGGERS) {
      const loser = await withMeetingHistoryMaterialization(1, 9, async (tx) => {
        await createTrigger(tx as unknown as MockPrisma, name, `blocked-${name}`);
      });
      expect(loser).toEqual({ ok: false, reason: "source-mutation" });
      expect(durableBytes()).toEqual(before);
    }

    const pointer = await withActiveMeetingTranscriptMutation(
      1,
      9,
      "UPLOADING",
      async (tx) => {
        await tx.meeting.update({
          where: { id: 9 },
          data: { audioStorageKey: "uploads/meetings/9/synthetic.wav" },
        });
        return "pointer";
      },
    );
    expect(pointer).toEqual({ ok: true, value: "pointer" });

    const armed = await withActiveMeetingTranscriptMutation(
      1,
      9,
      "UPLOADING",
      async (tx) => {
        await tx.meeting.update({
          where: { id: 9 },
          data: {
            status: "TRANSCRIBING",
            transcriptionJobId: "WHISPERX:synthetic-1",
          },
        });
        return "armed";
      },
    );
    expect(armed).toEqual({ ok: true, value: "armed" });

    const whileProviderActive = await withMeetingHistoryMaterialization(
      1,
      9,
      async (tx) => createTrigger(tx as unknown as MockPrisma, TRIGGERS[0], "blocked-provider"),
    );
    expect(whileProviderActive).toEqual({ ok: false, reason: "source-mutation" });
    expect(durableBytes()).toEqual(before);

    const completed = await withActiveMeetingTranscriptMutation(
      1,
      9,
      "TRANSCRIBING",
      async (tx) => {
        await tx.meeting.update({ where: { id: 9 }, data: { status: "READY" } });
      },
    );
    expect(completed.ok).toBe(true);

    for (const name of TRIGGERS) {
      const retry = await withMeetingHistoryMaterialization(1, 9, async (tx) => {
        await createTrigger(tx as unknown as MockPrisma, name, `retry-${name}`);
      });
      expect(retry.ok).toBe(true);
    }
    expect(
      await meetingHasDurableHistory(
        state.prisma as unknown as Parameters<typeof meetingHasDurableHistory>[0],
        9,
        1,
      ),
    ).toBe(true);
    for (const name of TRIGGERS) expect(state.prisma[name].rows).toHaveLength(1);
  });
});
