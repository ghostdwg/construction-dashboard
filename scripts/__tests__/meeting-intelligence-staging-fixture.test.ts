import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FIXTURE_AUDIT_ACTION,
  FIXTURE_BID_NAME,
  FIXTURE_CLASSIFICATION,
  FIXTURE_CONFIRMATION_PHRASE,
  FIXTURE_ENABLE_ENV,
  FIXTURE_LOCATION,
  FIXTURE_MEDIA_FILE_NAME,
  FIXTURE_MEETING_TITLE,
  FIXTURE_VERSION,
  buildSyntheticWav,
  classifyDatabaseTarget,
  parseArgv,
  runMain,
  syntheticWavSha256,
  type SeederDependencies,
} from "../meeting-intelligence-staging-fixture";

const REVISION = "a".repeat(40);
const OTHER_REVISION = "b".repeat(40);
const SECRET = "fixture-test-secret-token";

type BidRow = {
  id: number;
  projectName: string;
  location: string | null;
  description: string | null;
  scope: string;
  status: string;
  workflowType: string;
};

type MeetingRow = {
  id: number;
  bidId: number;
  title: string;
  meetingDate: Date;
  meetingType: string;
  location: string | null;
  status: string;
  audioStorageKey: string | null;
  audioFileName: string | null;
  processingMode: string;
  uploadedAt: Date | null;
};

type AuditRow = {
  id: string;
  category: string;
  action: string;
  subjectKind: string | null;
  subjectId: string | null;
  payloadJson: string | null;
  emittedAt: Date;
};

function cloneBid(row: BidRow): BidRow {
  return { ...row };
}

function cloneMeeting(row: MeetingRow): MeetingRow {
  return {
    ...row,
    meetingDate: new Date(row.meetingDate),
    uploadedAt: row.uploadedAt ? new Date(row.uploadedAt) : null,
  };
}

function cloneAudit(row: AuditRow): AuditRow {
  return { ...row, emittedAt: new Date(row.emittedAt) };
}

function makeHarness() {
  const state = {
    bids: [
      {
        id: 100,
        projectName: FIXTURE_BID_NAME,
        location: FIXTURE_LOCATION,
        description: "Created by an operator through the application.",
        scope: FIXTURE_CLASSIFICATION,
        status: "awarded",
        workflowType: "PROJECT",
      },
    ] as BidRow[],
    meetings: [
      {
        id: 200,
        bidId: 100,
        title: FIXTURE_MEETING_TITLE,
        meetingDate: new Date("2026-07-23T12:00:00.000Z"),
        meetingType: "GENERAL",
        location: FIXTURE_LOCATION,
        status: "PENDING",
        audioStorageKey: null,
        audioFileName: null,
        processingMode: "AUTO",
        uploadedAt: null,
      },
    ] as MeetingRow[],
    audits: [] as AuditRow[],
    blobs: new Map<string, Buffer>(),
    nextAuditId: 1,
    failAuditCreate: false,
    forceConditionalMiss: false,
    history: {
      artifacts: 0,
      segments: 0,
      candidates: 0,
      workerJobs: 0,
    },
  };

  const blobPut = vi.fn(async (key: string, data: Buffer, options?: { contentType?: string }) => {
    state.blobs.set(key, Buffer.from(data));
    return {
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      storedAt: "2026-07-22T00:00:00.000Z",
      contentType: options?.contentType,
    };
  });
  const blobStat = vi.fn(async (key: string) => {
    const data = state.blobs.get(key);
    return data
      ? {
          size: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          modifiedAt: new Date("2026-07-22T00:00:00.000Z"),
          contentType: "audio/wav",
        }
      : null;
  });
  const blobDelete = vi.fn(async (key: string) => {
    state.blobs.delete(key);
  });
  const blobGet = vi.fn(async (key: string) => Buffer.from(state.blobs.get(key) ?? []));
  const blobExists = vi.fn(async (key: string) => state.blobs.has(key));

  const tx = {
    bid: {
      findUnique: vi.fn(async (args: { where: { id: number } }) => {
        const row = state.bids.find((candidate) => candidate.id === args.where.id);
        return row ? cloneBid(row) : null;
      }),
    },
    meeting: {
      findUnique: vi.fn(async (args: { where: { id: number } }) => {
        const row = state.meetings.find((candidate) => candidate.id === args.where.id);
        return row ? cloneMeeting(row) : null;
      }),
      findFirst: vi.fn(
        async (args: {
          where: { audioStorageKey: string; id?: { not: number } };
        }) => {
          const row = state.meetings.find(
            (candidate) =>
              candidate.audioStorageKey === args.where.audioStorageKey &&
              candidate.id !== args.where.id?.not,
          );
          return row ? { id: row.id } : null;
        },
      ),
      updateMany: vi.fn(
        async (args: {
          where: {
            id: number;
            bidId: number;
            status: string;
            audioStorageKey: null;
            audioFileName: null;
            uploadedAt: null;
          };
          data: Pick<MeetingRow, "audioStorageKey" | "audioFileName" | "uploadedAt">;
        }) => {
          if (state.forceConditionalMiss) return { count: 0 };
          const row = state.meetings.find(
            (candidate) =>
              candidate.id === args.where.id &&
              candidate.bidId === args.where.bidId &&
              candidate.status === args.where.status &&
              candidate.audioStorageKey === null &&
              candidate.audioFileName === null &&
              candidate.uploadedAt === null,
          );
          if (!row) return { count: 0 };
          Object.assign(row, args.data);
          return { count: 1 };
        },
      ),
    },
    auditEvent: {
      findMany: vi.fn(
        async (args: {
          where: { action: string; subjectKind: string; subjectId: string };
          take: number;
        }) =>
          state.audits
            .filter(
              (row) =>
                row.action === args.where.action &&
                row.subjectKind === args.where.subjectKind &&
                row.subjectId === args.where.subjectId,
            )
            .slice(0, args.take)
            .map(cloneAudit),
      ),
      create: vi.fn(async (args: { data: Omit<AuditRow, "id" | "emittedAt"> }) => {
        if (state.failAuditCreate) throw new Error(`audit failed ${SECRET} /private/path`);
        const row: AuditRow = {
          id: `audit-${state.nextAuditId++}`,
          emittedAt: new Date("2026-07-22T12:00:00.000Z"),
          ...args.data,
        };
        state.audits.push(row);
        return cloneAudit(row);
      }),
    },
    meetingIntelligenceArtifact: {
      count: vi.fn(async () => state.history.artifacts),
    },
    meetingIntelligenceSegment: {
      count: vi.fn(async () => state.history.segments),
    },
    meetingIntelligenceCandidate: {
      count: vi.fn(async () => state.history.candidates),
    },
    meetingIntelligenceWorkerJob: {
      count: vi.fn(async () => state.history.workerJobs),
    },
  };

  const transaction = vi.fn(async <T>(fn: (client: typeof tx) => Promise<T>) => {
    const snapshot = {
      bids: state.bids.map(cloneBid),
      meetings: state.meetings.map(cloneMeeting),
      audits: state.audits.map(cloneAudit),
      nextAuditId: state.nextAuditId,
    };
    try {
      return await fn(tx);
    } catch (caught) {
      state.bids = snapshot.bids;
      state.meetings = snapshot.meetings;
      state.audits = snapshot.audits;
      state.nextAuditId = snapshot.nextAuditId;
      throw caught;
    }
  });

  const findReferencedMeeting = vi.fn(async (args: { where: { audioStorageKey: string } }) => {
    const row = state.meetings.find(
      (candidate) => candidate.audioStorageKey === args.where.audioStorageKey,
    );
    return row ? { id: row.id } : null;
  });

  const dependencies: SeederDependencies = {
    prisma: {
      $transaction: transaction as SeederDependencies["prisma"]["$transaction"],
      meeting: { findFirst: findReferencedMeeting },
    },
    blobStore: {
      put: blobPut,
      stat: blobStat,
      delete: blobDelete,
      get: blobGet,
      exists: blobExists,
    },
  };

  return {
    state,
    dependencies,
    tx,
    transaction,
    findReferencedMeeting,
    blobPut,
    blobStat,
    blobDelete,
  };
}

function stagingEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_ENV: "staging",
    APP_IMAGE_REVISION: REVISION,
    DATABASE_URL: `libsql://groundworx-staging-fixture.turso.io?authToken=${SECRET}`,
    [FIXTURE_ENABLE_ENV]: "1",
    ...overrides,
  };
}

function applyArgs(manifest: string): string[] {
  return [
    "--seed",
    "--apply",
    "--bid-id",
    "100",
    "--meeting-id",
    "200",
    "--expected-revision",
    REVISION,
    "--manifest",
    manifest,
    "--confirm",
    FIXTURE_CONFIRMATION_PHRASE,
  ];
}

let temporaryDirectories: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function manifestPath(name = "fixture-manifest.json"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gwx-fixture-seeder-test-"));
  temporaryDirectories.push(dir);
  return path.join(dir, name);
}

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  for (const dir of temporaryDirectories) await fs.rm(dir, { recursive: true, force: true });
  temporaryDirectories = [];
  vi.restoreAllMocks();
});

describe("preflight safety gates", () => {
  test("defaults disabled and performs no database or BlobStore operation", async () => {
    const harness = makeHarness();
    expect(await runMain([], { env: {}, dependencies: harness.dependencies })).toBe(0);
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.blobPut).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().join(" ")).toContain("DRY RUN");
  });

  test("--seed without --apply remains dry-run only", async () => {
    const harness = makeHarness();
    expect(
      await runMain(["--seed", "--confirm", FIXTURE_CONFIRMATION_PHRASE], {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.blobPut).not.toHaveBeenCalled();
  });

  test.each(["local", "production", "development", ""])(
    "denies non-staging APP_ENV=%s",
    async (appEnv) => {
      const harness = makeHarness();
      expect(
        await runMain(applyArgs(await manifestPath()), {
          env: stagingEnv({ APP_ENV: appEnv }),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
      expect(harness.transaction).not.toHaveBeenCalled();
    },
  );

  test("denies an ambiguous database target without loading Prisma", async () => {
    const harness = makeHarness();
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv({ DATABASE_URL: "file:/tmp/staging.db" }),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  test("denies production and mixed staging/production database markers", async () => {
    expect(classifyDatabaseTarget("libsql://groundworx-prod-ghostdwg.turso.io")).toBe(
      "production",
    );
    expect(
      classifyDatabaseTarget(
        "libsql://groundworx-staging-fixture.turso.io/db?target=groundworx-prod",
      ),
    ).toBe("ambiguous");
    for (const databaseUrl of [
      "libsql://groundworx-prod-ghostdwg.turso.io",
      "libsql://groundworx-staging-fixture.turso.io/db?target=groundworx-prod",
    ]) {
      const harness = makeHarness();
      expect(
        await runMain(applyArgs(await manifestPath()), {
          env: stagingEnv({ DATABASE_URL: databaseUrl }),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
      expect(harness.transaction).not.toHaveBeenCalled();
    }
  });

  test("requires the explicit enable flag", async () => {
    const harness = makeHarness();
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv({ [FIXTURE_ENABLE_ENV]: "0" }),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  test("requires the exact confirmation phrase", async () => {
    const harness = makeHarness();
    const manifest = await manifestPath();
    const args = applyArgs(manifest);
    args[args.length - 1] = `${FIXTURE_CONFIRMATION_PHRASE} `;
    expect(
      await runMain(args, { env: stagingEnv(), dependencies: harness.dependencies }),
    ).toBe(1);
    expect(harness.transaction).not.toHaveBeenCalled();
    await expect(fs.stat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a revision mismatch and untraceable runtime revision", async () => {
    for (const runtimeRevision of [OTHER_REVISION, "", "abc123"]) {
      const harness = makeHarness();
      expect(
        await runMain(applyArgs(await manifestPath()), {
          env: stagingEnv({ APP_IMAGE_REVISION: runtimeRevision }),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
      expect(harness.transaction).not.toHaveBeenCalled();
    }
  });

  test("rejects a malformed operator revision before manifest or dependency use", async () => {
    const harness = makeHarness();
    const manifest = await manifestPath();
    const args = applyArgs(manifest);
    args[args.indexOf("--expected-revision") + 1] = REVISION.toUpperCase();
    expect(
      await runMain(args, { env: stagingEnv(), dependencies: harness.dependencies }),
    ).toBe(1);
    expect(harness.transaction).not.toHaveBeenCalled();
    await expect(fs.stat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("requires exact positive Bid and Meeting ids before dependency use", async () => {
    for (const flag of ["--bid-id", "--meeting-id"]) {
      const missingHarness = makeHarness();
      const missingArgs = applyArgs(await manifestPath());
      missingArgs.splice(missingArgs.indexOf(flag), 2);
      expect(
        await runMain(missingArgs, {
          env: stagingEnv(),
          dependencies: missingHarness.dependencies,
        }),
      ).toBe(1);
      expect(missingHarness.transaction).not.toHaveBeenCalled();

      for (const value of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
        const harness = makeHarness();
        const args = applyArgs(await manifestPath());
        args[args.indexOf(flag) + 1] = value;
        expect(
          await runMain(args, { env: stagingEnv(), dependencies: harness.dependencies }),
        ).toBe(1);
        expect(harness.transaction).not.toHaveBeenCalled();
      }
    }
  });

  test("denies any ALLOW_PROD_DB presence before dependency use", async () => {
    for (const value of ["", "0", "1", "false"]) {
      const harness = makeHarness();
      expect(
        await runMain(applyArgs(await manifestPath()), {
          env: stagingEnv({ ALLOW_PROD_DB: value }),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
      expect(harness.transaction).not.toHaveBeenCalled();
      expect(harness.blobStat).not.toHaveBeenCalled();
    }
  });

  test("positively classifies only staging Turso hosts without credentials or mixed markers", () => {
    expect(classifyDatabaseTarget("libsql://groundworx-staging-fixture.turso.io")).toBe(
      "staging",
    );
    expect(
      classifyDatabaseTarget("https://groundworx-staging-fixture.turso.io/database"),
    ).toBe("staging");
    expect(
      classifyDatabaseTarget("libsql://groundworx-staging-fixture.turso.io.evil.example"),
    ).toBe("ambiguous");
    expect(
      classifyDatabaseTarget("libsql://user:secret@groundworx-staging-fixture.turso.io"),
    ).toBe("ambiguous");
    expect(
      classifyDatabaseTarget(
        "libsql://groundworx-staging-fixture.turso.io/db?target=groundworx%2Dprod",
      ),
    ).toBe("ambiguous");
  });

  test("rejects every operator-provided media path before dependencies are used", async () => {
    const harness = makeHarness();
    for (const flag of ["--media-path", "--audio-path", "--file", "--upload"]) {
      const parsed = parseArgv([flag, `/tmp/${SECRET}.wav`]);
      expect(parsed.errors).toContain(
        "Operator-provided media is prohibited; media is generated in memory.",
      );
      expect(
        await runMain([flag, `/tmp/${SECRET}.wav`], {
          env: stagingEnv(),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
    }
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.blobPut).not.toHaveBeenCalled();
  });

  test("has no cleanup or purge capability", async () => {
    const harness = makeHarness();
    for (const flag of ["--cleanup", "--purge", "--delete"]) {
      expect(
        await runMain([flag], { env: stagingEnv(), dependencies: harness.dependencies }),
      ).toBe(1);
    }
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.blobDelete).not.toHaveBeenCalled();
  });
});

describe("synthetic media and provider exclusion", () => {
  test("generates the exact deterministic valid WAV checksum", () => {
    const first = buildSyntheticWav();
    const second = buildSyntheticWav();
    expect(first).toEqual(second);
    expect(first.length).toBe(32_044);
    expect(first.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(first.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(first.readUInt16LE(22)).toBe(1);
    expect(first.readUInt32LE(24)).toBe(16_000);
    expect(first.readUInt16LE(34)).toBe(16);
    expect(first.subarray(44).every((byte) => byte === 0)).toBe(true);
    expect(syntheticWavSha256()).toBe(
      "643f8a8dc8bd9c19225afffad2becfec5426180b3749cb208abdf1a6c8354efc",
    );
  });

  test("source imports only the governed data/storage helpers and contains no network call", async () => {
    const source = await fs.readFile(
      path.resolve("scripts/meeting-intelligence-staging-fixture.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(imports.every((specifier) => specifier.startsWith("node:") || [
      "@/lib/prisma",
      "@/lib/storage/blobStore",
      "@/lib/services/meetings/storagePath",
    ].includes(specifier))).toBe(true);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/app\/api\//);
    expect(source).not.toMatch(/source-mapping\/route/);
    expect(source).not.toMatch(/upload-hybrid\/route/);
    expect(source).not.toMatch(/new\s+BackgroundJob/);
    expect(source).not.toMatch(/from\s+["'][^"']*(assemblyai|whisperx|anthropic)/i);
  });

  test("execution does not invoke a global network function", async () => {
    const harness = makeHarness();
    const networkSpy = vi.fn();
    vi.stubGlobal("fetch", networkSpy);
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);
    expect(networkSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("fixture attachment, identity, audit, and idempotency", () => {
  test("attaches one WAV to only the exact pre-created fixture Meeting", async () => {
    const harness = makeHarness();
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);

    expect(harness.blobPut).toHaveBeenCalledTimes(1);
    const [key, bytes, options] = harness.blobPut.mock.calls[0];
    expect(key).toBe(
      `plan-room/jobs/100/meetings/200/${FIXTURE_VERSION}/${FIXTURE_MEDIA_FILE_NAME}`,
    );
    expect(bytes).toEqual(buildSyntheticWav());
    expect(options).toEqual({ contentType: "audio/wav" });
    expect(harness.state.bids).toHaveLength(1);
    expect(harness.state.meetings).toHaveLength(1);
    expect(harness.state.audits).toHaveLength(1);
    expect(harness.state.meetings[0]).toMatchObject({
      bidId: 100,
      title: FIXTURE_MEETING_TITLE,
      location: FIXTURE_LOCATION,
      status: "PENDING",
      processingMode: "AUTO",
      audioStorageKey: key,
      audioFileName: FIXTURE_MEDIA_FILE_NAME,
    });
    expect(harness.tx.bid.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 100 } }),
    );
    expect(harness.tx.meeting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 200 } }),
    );
    expect(harness.tx.meeting.updateMany).toHaveBeenCalledTimes(1);
    const update = harness.tx.meeting.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: 200,
      bidId: 100,
      status: "PENDING",
      audioStorageKey: null,
      audioFileName: null,
      uploadedAt: null,
    });
    expect(Object.keys(update.data).sort()).toEqual([
      "audioFileName",
      "audioStorageKey",
      "uploadedAt",
    ]);
  });

  test("uses stable unmistakable fixture identity and exact permanent classification", async () => {
    const harness = makeHarness();
    await runMain(applyArgs(await manifestPath()), {
      env: stagingEnv(),
      dependencies: harness.dependencies,
    });
    expect(harness.state.bids[0]).toMatchObject({
      projectName: FIXTURE_BID_NAME,
      location: FIXTURE_LOCATION,
      scope: expect.stringContaining(FIXTURE_CLASSIFICATION),
      status: "awarded",
      workflowType: "PROJECT",
    });
    expect(FIXTURE_BID_NAME).toContain("[PERMANENT]");
    expect(FIXTURE_MEETING_TITLE).toContain("[PERMANENT]");
  });

  test("creates one durable audit row with identifiers and checksum but no storage path", async () => {
    const harness = makeHarness();
    await runMain(applyArgs(await manifestPath()), {
      env: stagingEnv(),
      dependencies: harness.dependencies,
    });
    expect(harness.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    const audit = harness.state.audits[0];
    expect(audit).toMatchObject({
      category: "register_action",
      action: FIXTURE_AUDIT_ACTION,
      subjectKind: "Meeting",
      subjectId: "200",
    });
    const payload = JSON.parse(audit.payloadJson!);
    expect(payload).toMatchObject({
      fixtureVersion: FIXTURE_VERSION,
      classification: FIXTURE_CLASSIFICATION,
      bidId: 100,
      meetingId: 200,
      mediaSha256: syntheticWavSha256(),
      mediaBytes: 32_044,
      applicationRevision: REVISION,
    });
    expect(audit.payloadJson).not.toContain("plan-room/");
    expect(audit.payloadJson).not.toContain(SECRET);
  });

  test("an exact rerun is idempotent and writes no second blob, row, or audit", async () => {
    const harness = makeHarness();
    const manifest = await manifestPath();
    expect(
      await runMain(applyArgs(manifest), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);
    expect(
      await runMain(applyArgs(manifest), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);
    expect(harness.blobPut).toHaveBeenCalledTimes(1);
    expect(harness.tx.meeting.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(harness.state.bids).toHaveLength(1);
    expect(harness.state.meetings).toHaveLength(1);
    expect(harness.state.audits).toHaveLength(1);
  });

  test("refuses a wrong Bid label for the exact requested id", async () => {
    const harness = makeHarness();
    harness.state.bids[0].projectName = "Customer record";
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.blobPut).not.toHaveBeenCalled();
    expect(harness.tx.meeting.updateMany).not.toHaveBeenCalled();
    expect(harness.state.bids).toHaveLength(1);
  });

  test("refuses a cross-Bid Meeting before BlobStore mutation", async () => {
    const harness = makeHarness();
    harness.state.meetings[0].bidId = 999;
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.tx.meeting.updateMany).not.toHaveBeenCalled();
    expect(harness.blobPut).not.toHaveBeenCalled();
  });

  test.each([
    ["title", "Customer meeting"],
    ["location", "Customer location"],
    ["status", "AWAITING_SOURCE_MAP"],
  ] as const)("refuses a Meeting with mismatched %s", async (field, value) => {
    const harness = makeHarness();
    harness.state.meetings[0][field] = value;
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.tx.meeting.updateMany).not.toHaveBeenCalled();
    expect(harness.blobPut).not.toHaveBeenCalled();
  });

  test("refuses partial or foreign pre-existing media state", async () => {
    for (const mutation of [
      (meeting: MeetingRow) => {
        meeting.audioStorageKey = "plan-room/customer.wav";
      },
      (meeting: MeetingRow) => {
        meeting.audioFileName = "customer.wav";
      },
      (meeting: MeetingRow) => {
        meeting.uploadedAt = new Date("2026-07-23T13:00:00.000Z");
      },
    ]) {
      const harness = makeHarness();
      mutation(harness.state.meetings[0]);
      expect(
        await runMain(applyArgs(await manifestPath()), {
          env: stagingEnv(),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
      expect(harness.tx.meeting.updateMany).not.toHaveBeenCalled();
      expect(harness.blobPut).not.toHaveBeenCalled();
    }
  });

  test.each(["artifacts", "segments", "candidates", "workerJobs"] as const)(
    "refuses pre-existing Meeting Intelligence %s history",
    async (historyKind) => {
      const harness = makeHarness();
      harness.state.history[historyKind] = 1;
      expect(
        await runMain(applyArgs(await manifestPath()), {
          env: stagingEnv(),
          dependencies: harness.dependencies,
        }),
      ).toBe(1);
      expect(harness.tx.meeting.updateMany).not.toHaveBeenCalled();
      expect(harness.blobPut).not.toHaveBeenCalled();
      expect(harness.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );

  test("refuses an idempotent-looking rerun after durable MI history exists", async () => {
    const harness = makeHarness();
    expect(
      await runMain(applyArgs(await manifestPath("first.json")), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);
    harness.state.history.artifacts = 1;
    expect(
      await runMain(applyArgs(await manifestPath("second.json")), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.blobPut).toHaveBeenCalledTimes(1);
    expect(harness.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  test("a lost conditional claim refuses without writing a blob or audit", async () => {
    const harness = makeHarness();
    harness.state.forceConditionalMiss = true;
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.tx.meeting.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.blobPut).not.toHaveBeenCalled();
    expect(harness.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(harness.state.meetings[0].audioStorageKey).toBeNull();
  });

  test("refuses a media or audit collision instead of treating it as idempotent", async () => {
    const harness = makeHarness();
    await runMain(applyArgs(await manifestPath("first.json")), {
      env: stagingEnv(),
      dependencies: harness.dependencies,
    });
    harness.state.audits.length = 0;
    expect(
      await runMain(applyArgs(await manifestPath("second.json")), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.blobPut).toHaveBeenCalledTimes(1);
  });
});

describe("manifest and failure handling", () => {
  test("writes a mode-0600 redacted manifest with only non-secret evidence", async () => {
    const harness = makeHarness();
    const manifest = await manifestPath();
    expect(
      await runMain(applyArgs(manifest), {
        env: stagingEnv({ EXTRA_TOKEN_FOR_TEST: SECRET }),
        dependencies: harness.dependencies,
      }),
    ).toBe(0);
    const stat = await fs.stat(manifest);
    expect(stat.mode & 0o777).toBe(0o600);
    const text = await fs.readFile(manifest, "utf8");
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      fixtureVersion: FIXTURE_VERSION,
      classification: FIXTURE_CLASSIFICATION,
      bidId: 100,
      meetingId: 200,
      mediaSha256: syntheticWavSha256(),
      seedApplicationRevision: REVISION,
    });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("authToken");
    expect(text).not.toContain("plan-room/");
    expect(`${logSpy.mock.calls.flat().join(" ")} ${errorSpy.mock.calls.flat().join(" ")}`).not.toContain(
      SECRET,
    );
  });

  test("Docker runtime carries the CLI without duplicating the approved revision promotion", async () => {
    const dockerfile = await fs.readFile(path.resolve("Dockerfile"), "utf8");
    expect(dockerfile).toContain("org.opencontainers.image.revision=\"${IMAGE_REVISION}\"");
    expect(dockerfile.match(/^ARG IMAGE_REVISION$/gm)).toHaveLength(1);
    expect(dockerfile.match(/^ENV APP_IMAGE_REVISION=/gm) ?? []).toHaveLength(0);
    expect(dockerfile).toContain("meeting-intelligence-staging-fixture.mjs");
    expect(dockerfile).toContain("--external:@prisma/client");
    expect(dockerfile).toContain("--external:@prisma/adapter-libsql");
  });

  test("refuses to overwrite different manifest evidence", async () => {
    const harness = makeHarness();
    const manifest = await manifestPath();
    await fs.writeFile(manifest, `different-${SECRET}`, { mode: 0o600 });
    expect(
      await runMain(applyArgs(manifest), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(await fs.readFile(manifest, "utf8")).toBe(`different-${SECRET}`);
    expect(harness.tx.meeting.updateMany).not.toHaveBeenCalled();
    expect(harness.blobPut).not.toHaveBeenCalled();
    expect(harness.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(harness.state.meetings[0].audioStorageKey).toBeNull();
  });

  test("transaction failure rolls back rows and deletes only the newly allocated unreferenced blob", async () => {
    const harness = makeHarness();
    harness.state.failAuditCreate = true;
    const manifest = await manifestPath();
    expect(
      await runMain(applyArgs(manifest), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(2);
    expect(harness.state.bids).toHaveLength(1);
    expect(harness.state.meetings).toHaveLength(1);
    expect(harness.state.meetings[0].audioStorageKey).toBeNull();
    expect(harness.state.meetings[0].audioFileName).toBeNull();
    expect(harness.state.meetings[0].uploadedAt).toBeNull();
    expect(harness.state.audits).toHaveLength(0);
    expect(harness.blobDelete).toHaveBeenCalledTimes(1);
    expect(harness.state.blobs.size).toBe(0);
    await expect(fs.stat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
    const leftovers = (await fs.readdir(path.dirname(manifest))).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    const output = `${logSpy.mock.calls.flat().join(" ")} ${errorSpy.mock.calls.flat().join(" ")}`;
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain("/private/path");
  });

  test("does not delete a preexisting blob on a collision", async () => {
    const harness = makeHarness();
    const expectedKey =
      `plan-room/jobs/100/meetings/200/${FIXTURE_VERSION}/${FIXTURE_MEDIA_FILE_NAME}`;
    harness.state.blobs.set(expectedKey, Buffer.from("preexisting-non-fixture"));
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.blobPut).not.toHaveBeenCalled();
    expect(harness.blobDelete).not.toHaveBeenCalled();
    expect(harness.state.blobs.get(expectedKey)?.toString()).toBe("preexisting-non-fixture");
  });

  test("compensation never deletes a blob referenced by another Meeting", async () => {
    const harness = makeHarness();
    const expectedKey =
      `plan-room/jobs/100/meetings/200/${FIXTURE_VERSION}/${FIXTURE_MEDIA_FILE_NAME}`;
    harness.state.meetings.push({
      ...cloneMeeting(harness.state.meetings[0]),
      id: 201,
      audioStorageKey: expectedKey,
    });
    harness.state.failAuditCreate = true;
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(2);
    expect(harness.blobPut).toHaveBeenCalledTimes(1);
    expect(harness.blobDelete).not.toHaveBeenCalled();
    expect(harness.state.blobs.get(expectedKey)).toEqual(buildSyntheticWav());
    expect(harness.state.meetings[0].audioStorageKey).toBeNull();
  });
});
