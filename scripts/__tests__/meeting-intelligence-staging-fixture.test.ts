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
    bids: [] as BidRow[],
    meetings: [] as MeetingRow[],
    audits: [] as AuditRow[],
    blobs: new Map<string, Buffer>(),
    nextBidId: 100,
    nextMeetingId: 200,
    nextAuditId: 1,
    failAuditCreate: false,
    failMeetingUpdate: false,
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
      findMany: vi.fn(async (args: { where: { projectName: string }; take: number }) =>
        state.bids
          .filter((row) => row.projectName === args.where.projectName)
          .slice(0, args.take)
          .map(cloneBid),
      ),
      create: vi.fn(async (args: { data: Omit<BidRow, "id"> }) => {
        const row: BidRow = { id: state.nextBidId++, ...args.data };
        state.bids.push(row);
        return cloneBid(row);
      }),
    },
    meeting: {
      findMany: vi.fn(
        async (args: { where: { bidId: number; title: string }; take: number }) =>
          state.meetings
            .filter(
              (row) => row.bidId === args.where.bidId && row.title === args.where.title,
            )
            .slice(0, args.take)
            .map(cloneMeeting),
      ),
      create: vi.fn(
        async (args: {
          data: Omit<MeetingRow, "id" | "audioStorageKey" | "audioFileName" | "uploadedAt">;
        }) => {
          const row: MeetingRow = {
            id: state.nextMeetingId++,
            audioStorageKey: null,
            audioFileName: null,
            uploadedAt: null,
            ...args.data,
          };
          state.meetings.push(row);
          return cloneMeeting(row);
        },
      ),
      update: vi.fn(
        async (args: {
          where: { id: number };
          data: Pick<MeetingRow, "audioStorageKey" | "audioFileName" | "uploadedAt">;
        }) => {
          if (state.failMeetingUpdate) throw new Error("synthetic update failure with /secret/path");
          const row = state.meetings.find((candidate) => candidate.id === args.where.id);
          if (!row) throw new Error("missing meeting");
          Object.assign(row, args.data);
          return cloneMeeting(row);
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
  };

  const transaction = vi.fn(async <T>(fn: (client: typeof tx) => Promise<T>) => {
    const snapshot = {
      bids: state.bids.map(cloneBid),
      meetings: state.meetings.map(cloneMeeting),
      audits: state.audits.map(cloneAudit),
      nextBidId: state.nextBidId,
      nextMeetingId: state.nextMeetingId,
      nextAuditId: state.nextAuditId,
    };
    try {
      return await fn(tx);
    } catch (caught) {
      state.bids = snapshot.bids;
      state.meetings = snapshot.meetings;
      state.audits = snapshot.audits;
      state.nextBidId = snapshot.nextBidId;
      state.nextMeetingId = snapshot.nextMeetingId;
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
    const args = applyArgs(await manifestPath());
    args[args.length - 1] = `${FIXTURE_CONFIRMATION_PHRASE} `;
    expect(
      await runMain(args, { env: stagingEnv(), dependencies: harness.dependencies }),
    ).toBe(1);
    expect(harness.transaction).not.toHaveBeenCalled();
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

describe("fixture creation, identity, audit, and idempotency", () => {
  test("writes one WAV through BlobStore and creates only the pre-queue fixture records", async () => {
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
    expect(harness.tx.bid.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.meeting.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(harness.state.bids).toHaveLength(1);
    expect(harness.state.meetings).toHaveLength(1);
    expect(harness.state.audits).toHaveLength(1);
  });

  test("refuses to overwrite or repurpose a non-fixture record with the canonical label", async () => {
    const harness = makeHarness();
    harness.state.bids.push({
      id: 77,
      projectName: FIXTURE_BID_NAME,
      location: "Customer location",
      description: "Customer record",
      scope: "real work",
      status: "draft",
      workflowType: "PROJECT",
    });
    expect(
      await runMain(applyArgs(await manifestPath()), {
        env: stagingEnv(),
        dependencies: harness.dependencies,
      }),
    ).toBe(1);
    expect(harness.blobPut).not.toHaveBeenCalled();
    expect(harness.tx.bid.create).not.toHaveBeenCalled();
    expect(harness.state.bids).toHaveLength(1);
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

  test("Docker runtime carries the bundled CLI and mirrors the immutable OCI revision", async () => {
    const dockerfile = await fs.readFile(path.resolve("Dockerfile"), "utf8");
    expect(dockerfile).toContain("org.opencontainers.image.revision=\"${IMAGE_REVISION}\"");
    expect(dockerfile).toContain("ENV APP_IMAGE_REVISION=\"${IMAGE_REVISION}\"");
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
    expect(harness.state.bids).toHaveLength(0);
    expect(harness.state.meetings).toHaveLength(0);
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
});
