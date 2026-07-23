#!/usr/bin/env -S node --import=tsx

import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { meetingAudioStorageKey } from "@/lib/services/meetings/storagePath";
import { safeBlobFileName, type BlobStore } from "@/lib/storage/blobStore";

export const FIXTURE_VERSION = "gwx-mi-v2-staging-permanent-v1";
export const FIXTURE_CLASSIFICATION = "SYNTHETIC_STAGING_PERMANENT";
export const FIXTURE_BID_NAME =
  "[STAGING FIXTURE][MI-V2][PERMANENT] NON-CUSTOMER TASKING PROOF";
export const FIXTURE_MEETING_TITLE =
  "[STAGING FIXTURE][MI-V2][PERMANENT] SYNTHETIC MEDIA";
export const FIXTURE_LOCATION = "SYNTHETIC STAGING FIXTURE — NO CUSTOMER DATA";
export const FIXTURE_MEDIA_FILE_NAME = "gwx-mi-v2-synthetic-silence-v1.wav";
export const FIXTURE_CONFIRMATION_PHRASE =
  "I UNDERSTAND THIS CREATES PERMANENT MEETING INTELLIGENCE FIXTURE HISTORY";
export const FIXTURE_ENABLE_ENV = "MEETING_INTELLIGENCE_FIXTURE_SEEDING_ENABLED";
export const FIXTURE_ENABLE_VALUE = "1";
export const FIXTURE_AUDIT_ACTION = "meeting_intelligence_fixture_media_seeded";

const PREFIX = "[meeting-intelligence-staging-fixture]";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export type ParsedArgs = {
  seed: boolean;
  apply: boolean;
  dryRun: boolean;
  bidId?: number;
  meetingId?: number;
  expectedRevision?: string;
  confirm?: string;
  manifest?: string;
  help: boolean;
  errors: string[];
};

type FixtureBid = {
  id: number;
  projectName: string;
};

type FixtureMeeting = {
  id: number;
  bidId: number;
  title: string;
  location: string | null;
  status: string;
  audioStorageKey: string | null;
  audioFileName: string | null;
  uploadedAt: Date | null;
};

type FixtureAudit = {
  id: string;
  payloadJson: string | null;
  emittedAt: Date;
};

type TransactionClient = {
  bid: {
    findUnique(args: unknown): Promise<FixtureBid | null>;
  };
  meeting: {
    findUnique(args: unknown): Promise<FixtureMeeting | null>;
    findFirst(args: unknown): Promise<{ id: number } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  auditEvent: {
    findMany(args: unknown): Promise<FixtureAudit[]>;
    create(args: unknown): Promise<FixtureAudit>;
  };
  meetingIntelligenceArtifact: {
    count(args: unknown): Promise<number>;
  };
  meetingIntelligenceSegment: {
    count(args: unknown): Promise<number>;
  };
  meetingIntelligenceCandidate: {
    count(args: unknown): Promise<number>;
  };
  meetingIntelligenceWorkerJob: {
    count(args: unknown): Promise<number>;
  };
};

type PrismaClientLike = {
  $transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  meeting: {
    findFirst(args: unknown): Promise<{ id: number } | null>;
  };
};

export type SeederDependencies = {
  prisma: PrismaClientLike;
  blobStore: BlobStore;
};

type RuntimeEnvironment = Record<string, string | undefined>;

type SeedResult = {
  outcome: "created" | "already_present";
  bidId: number;
  meetingId: number;
  auditId: string;
  seededAt: string;
  seedApplicationRevision: string;
  mediaSha256: string;
  mediaBytes: number;
};

type FixtureManifest = {
  schemaVersion: 1;
  fixtureVersion: string;
  classification: string;
  bidId: number;
  meetingId: number;
  auditEventId: string;
  mediaFileName: string;
  mediaBytes: number;
  mediaSha256: string;
  seedApplicationRevision: string;
  seededAt: string;
};

type ManifestPreflight = {
  path: string;
  handle: Awaited<ReturnType<typeof fs.open>>;
  device: number;
  inode: number;
  existingContent: string | null;
  createdByThisRun: boolean;
};

class GateRefusal extends Error {}
class FixtureCollision extends Error {}
class CleanupProofFailure extends Error {}

function log(message: string): void {
  console.log(`${PREFIX} ${message}`);
}

function err(message: string): void {
  console.error(`${PREFIX} ${message}`);
}

const HELP_TEXT = `
meeting-intelligence-staging-fixture — governed staging-only permanent fixture seeder

Default behavior is a dry run. It performs no Prisma or BlobStore operation.

Apply the one canonical fixture:
  npm run seed:meeting-intelligence-staging-fixture -- \\
    --seed --apply \\
    --bid-id <positive-integer> \\
    --meeting-id <positive-integer> \\
    --expected-revision <full-40-character-git-sha> \\
    --manifest <absolute-output-path> \\
    --confirm "${FIXTURE_CONFIRMATION_PHRASE}"

Inside the deployed app container, invoke the bundled runtime artifact with:
  node scripts/meeting-intelligence-staging-fixture.mjs <the same flags>

Required runtime gates:
  APP_ENV=staging
  ${FIXTURE_ENABLE_ENV}=${FIXTURE_ENABLE_VALUE}
  DATABASE_URL positively classified as the staging database
  APP_IMAGE_REVISION equal to --expected-revision

The command accepts no media path. It always generates the fixed synthetic WAV in memory.
The Bid and Meeting must already exist with the exact permanent fixture labels.
There is no cleanup, purge, delete, or general-purpose fixture mode.
`;

export function parseArgv(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    seed: false,
    apply: false,
    dryRun: false,
    help: false,
    errors: [],
  };

  const takeValue = (index: number, flag: string): string | undefined => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      parsed.errors.push(`${flag} requires a value.`);
      return undefined;
    }
    return value;
  };

  const takePositiveId = (index: number, flag: string): number | undefined => {
    const value = takeValue(index, flag);
    if (value === undefined) return undefined;
    if (!POSITIVE_INTEGER_PATTERN.test(value)) {
      parsed.errors.push(`${flag} must be a positive integer.`);
      return undefined;
    }
    const parsedValue = Number(value);
    if (!Number.isSafeInteger(parsedValue)) {
      parsed.errors.push(`${flag} must be a safe positive integer.`);
      return undefined;
    }
    return parsedValue;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed") parsed.seed = true;
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--bid-id") {
      const value = argv[index + 1];
      parsed.bidId = takePositiveId(index, arg);
      if (value !== undefined && !value.startsWith("--")) index += 1;
    } else if (arg === "--meeting-id") {
      const value = argv[index + 1];
      parsed.meetingId = takePositiveId(index, arg);
      if (value !== undefined && !value.startsWith("--")) index += 1;
    } else if (arg === "--expected-revision") {
      parsed.expectedRevision = takeValue(index, arg);
      if (parsed.expectedRevision !== undefined) index += 1;
    } else if (arg === "--confirm") {
      parsed.confirm = takeValue(index, arg);
      if (parsed.confirm !== undefined) index += 1;
    } else if (arg === "--manifest") {
      parsed.manifest = takeValue(index, arg);
      if (parsed.manifest !== undefined) index += 1;
    } else if (
      arg === "--media-path" ||
      arg === "--audio-path" ||
      arg === "--file" ||
      arg === "--upload"
    ) {
      parsed.errors.push("Operator-provided media is prohibited; media is generated in memory.");
      if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) index += 1;
    } else if (arg === "--cleanup" || arg === "--purge" || arg === "--delete") {
      parsed.errors.push("Cleanup, purge, and delete capabilities are intentionally unavailable.");
    } else {
      parsed.errors.push(`Unknown option at argument position ${index + 1}.`);
    }
  }

  return parsed;
}

export type DatabaseClassification = "staging" | "production" | "ambiguous";

export function classifyDatabaseTarget(databaseUrl: string | undefined): DatabaseClassification {
  if (!databaseUrl) return "ambiguous";
  const lowered = databaseUrl.toLowerCase();
  let decoded = lowered;
  try {
    decoded = decodeURIComponent(lowered);
  } catch {
    return /groundworx[-_.]?prod|production/.test(lowered) ? "production" : "ambiguous";
  }
  const hasProductionMarker = /groundworx[-_.]?prod|production/.test(decoded);
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return hasProductionMarker ? "production" : "ambiguous";
  }

  const hostname = parsed.hostname.toLowerCase();
  const hasStagingMarker =
    /^groundworx-staging(?:-[a-z0-9-]+)?\.turso\.io$/.test(hostname);

  if (hasStagingMarker && hasProductionMarker) return "ambiguous";
  if (hasProductionMarker) return "production";
  if (!hasStagingMarker) return "ambiguous";
  if (parsed.protocol !== "libsql:" && parsed.protocol !== "https:") return "ambiguous";
  if (parsed.username || parsed.password) return "ambiguous";
  return "staging";
}

/** Deterministic one-second, 16 kHz, mono, signed-16-bit little-endian silent PCM WAV. */
export function buildSyntheticWav(): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = sampleRate;
  const dataBytes = sampleCount * channels * (bitsPerSample / 8);
  const wav = Buffer.alloc(44 + dataBytes, 0);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  wav.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

export function syntheticWavSha256(): string {
  return createHash("sha256").update(buildSyntheticWav()).digest("hex");
}

function assertApplyGates(args: ParsedArgs, runtimeEnv: RuntimeEnvironment): string {
  if (!args.seed) throw new GateRefusal("--seed is required with --apply.");
  if (args.dryRun) throw new GateRefusal("--apply and --dry-run cannot be combined.");
  if (args.bidId === undefined) throw new GateRefusal("--bid-id is required with --apply.");
  if (args.meetingId === undefined) throw new GateRefusal("--meeting-id is required with --apply.");
  if (runtimeEnv.APP_ENV !== "staging") {
    throw new GateRefusal("APP_ENV check failed; expected staging.");
  }
  if (runtimeEnv[FIXTURE_ENABLE_ENV] !== FIXTURE_ENABLE_VALUE) {
    throw new GateRefusal(`Fixture seeding is disabled; set ${FIXTURE_ENABLE_ENV}=1 explicitly.`);
  }
  if (runtimeEnv.ALLOW_PROD_DB !== undefined) {
    throw new GateRefusal("ALLOW_PROD_DB must be absent for fixture seeding.");
  }
  if (args.confirm !== FIXTURE_CONFIRMATION_PHRASE) {
    throw new GateRefusal("Confirmation phrase is missing or incorrect.");
  }
  if (!args.expectedRevision || !SHA_PATTERN.test(args.expectedRevision)) {
    throw new GateRefusal("--expected-revision must be a lowercase full 40-character Git SHA.");
  }
  const runtimeRevision = runtimeEnv.APP_IMAGE_REVISION;
  if (!runtimeRevision || !SHA_PATTERN.test(runtimeRevision)) {
    throw new GateRefusal("Runtime image revision is missing or untraceable.");
  }
  if (runtimeRevision !== args.expectedRevision) {
    throw new GateRefusal("Expected application revision does not match the runtime image revision.");
  }
  if (!args.manifest || !path.isAbsolute(args.manifest)) {
    throw new GateRefusal("--manifest must be an absolute output path.");
  }

  const databaseClassification = classifyDatabaseTarget(runtimeEnv.DATABASE_URL);
  if (databaseClassification === "production") {
    throw new GateRefusal("Database target is production-classified; refusing.");
  }
  if (databaseClassification !== "staging") {
    throw new GateRefusal("Database target is not positively staging-classified; refusing.");
  }
  return runtimeRevision;
}

function fixtureBidMatches(bid: FixtureBid): boolean {
  return bid.projectName === FIXTURE_BID_NAME;
}

function fixtureMeetingMatches(meeting: FixtureMeeting, bidId: number): boolean {
  return (
    meeting.bidId === bidId &&
    meeting.title === FIXTURE_MEETING_TITLE &&
    meeting.location === FIXTURE_LOCATION &&
    meeting.status === "PENDING"
  );
}

function parseAuditPayload(audit: FixtureAudit): Record<string, unknown> | null {
  if (!audit.payloadJson) return null;
  try {
    const parsed = JSON.parse(audit.payloadJson) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function auditMatches(
  audit: FixtureAudit,
  bidId: number,
  meetingId: number,
  checksum: string,
  byteCount: number,
): audit is FixtureAudit {
  const payload = parseAuditPayload(audit);
  return (
    payload?.fixtureVersion === FIXTURE_VERSION &&
    payload.classification === FIXTURE_CLASSIFICATION &&
    payload.bidId === bidId &&
    payload.meetingId === meetingId &&
    payload.mediaFileName === FIXTURE_MEDIA_FILE_NAME &&
    payload.mediaSha256 === checksum &&
    payload.mediaBytes === byteCount &&
    typeof payload.applicationRevision === "string" &&
    SHA_PATTERN.test(payload.applicationRevision)
  );
}

function seedRevisionFromAudit(audit: FixtureAudit): string {
  const revision = parseAuditPayload(audit)?.applicationRevision;
  if (typeof revision !== "string" || !SHA_PATTERN.test(revision)) {
    throw new FixtureCollision("Fixture audit revision is invalid.");
  }
  return revision;
}

async function loadDefaultDependencies(): Promise<SeederDependencies> {
  const [{ prisma }, { getBlobStore }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/storage/blobStore"),
  ]);
  return {
    prisma: prisma as unknown as PrismaClientLike,
    blobStore: getBlobStore(),
  };
}

async function createOrVerifyFixture(
  deps: SeederDependencies,
  runtimeRevision: string,
  bidId: number,
  meetingId: number,
  manifestAlreadyExists: boolean,
): Promise<SeedResult> {
  const media = buildSyntheticWav();
  const mediaSha256 = createHash("sha256").update(media).digest("hex");
  const mediaFileName = safeBlobFileName(FIXTURE_MEDIA_FILE_NAME);
  const allocatedKey = meetingAudioStorageKey(
    bidId,
    meetingId,
    FIXTURE_VERSION,
    mediaFileName,
  );
  let blobWriteAttempted = false;
  let blobCompensated = false;
  let transactionCommitted = false;

  try {
    const result = await deps.prisma.$transaction(async (tx) => {
      const bid = await tx.bid.findUnique({
        where: { id: bidId },
        select: { id: true, projectName: true },
      });
      if (!bid || !fixtureBidMatches(bid)) {
        throw new FixtureCollision("The exact Bid id is missing or does not match the fixture label.");
      }

      const meeting = await tx.meeting.findUnique({
        where: { id: meetingId },
        select: {
          id: true,
          bidId: true,
          title: true,
          location: true,
          status: true,
          audioStorageKey: true,
          audioFileName: true,
          uploadedAt: true,
        },
      });
      if (!meeting || !fixtureMeetingMatches(meeting, bidId)) {
        throw new FixtureCollision(
          "The exact Meeting id is missing, cross-Bid, non-PENDING, or does not match the fixture labels.",
        );
      }

      const [artifactCount, segmentCount, candidateCount, workerJobCount, audits] =
        await Promise.all([
          tx.meetingIntelligenceArtifact.count({ where: { meetingId } }),
          tx.meetingIntelligenceSegment.count({ where: { meetingId } }),
          tx.meetingIntelligenceCandidate.count({ where: { meetingId } }),
          tx.meetingIntelligenceWorkerJob.count({ where: { meetingId } }),
          tx.auditEvent.findMany({
            where: {
              action: FIXTURE_AUDIT_ACTION,
              subjectKind: "Meeting",
              subjectId: String(meetingId),
            },
            orderBy: { emittedAt: "asc" },
            take: 2,
          }),
        ]);
      if (artifactCount + segmentCount + candidateCount + workerJobCount !== 0) {
        throw new FixtureCollision(
          "Meeting Intelligence history already exists for the fixture Meeting.",
        );
      }

      const hasAnyMediaState =
        meeting.audioStorageKey !== null ||
        meeting.audioFileName !== null ||
        meeting.uploadedAt !== null;
      if (hasAnyMediaState) {
        if (
          meeting.audioStorageKey !== allocatedKey ||
          meeting.audioFileName !== mediaFileName ||
          meeting.uploadedAt === null
        ) {
          throw new FixtureCollision("Existing fixture media pointer does not exactly match.");
        }
        if (
          audits.length !== 1 ||
          !auditMatches(audits[0], bidId, meetingId, mediaSha256, media.length)
        ) {
          throw new FixtureCollision("Existing fixture lacks one exact seeder audit marker.");
        }
        const stat = await deps.blobStore.stat(allocatedKey);
        if (!stat || stat.sha256 !== mediaSha256 || stat.size !== media.length) {
          throw new FixtureCollision("Existing fixture media checksum or size does not match.");
        }
        return {
          outcome: "already_present" as const,
          bidId,
          meetingId,
          auditId: audits[0].id,
          seededAt: audits[0].emittedAt.toISOString(),
          seedApplicationRevision: seedRevisionFromAudit(audits[0]),
          mediaSha256,
          mediaBytes: media.length,
        };
      }

      if (audits.length !== 0) {
        throw new FixtureCollision("An audit marker exists without an exact seeded media pointer.");
      }
      if (manifestAlreadyExists) {
        throw new FixtureCollision(
          "Manifest destination already exists before the first fixture seed.",
        );
      }
      if (await deps.blobStore.stat(allocatedKey)) {
        throw new FixtureCollision("Canonical fixture BlobStore key is already occupied.");
      }

      const claimed = await tx.meeting.updateMany({
        where: {
          id: meetingId,
          bidId,
          status: "PENDING",
          audioStorageKey: null,
          audioFileName: null,
          uploadedAt: null,
        },
        data: {
          audioStorageKey: allocatedKey,
          audioFileName: mediaFileName,
          uploadedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new FixtureCollision("Concurrent Meeting mutation prevented the fixture pointer claim.");
      }

      try {
        blobWriteAttempted = true;
        const put = await deps.blobStore.put(allocatedKey, media, {
          contentType: "audio/wav",
        });
        if (put.sha256 !== mediaSha256 || put.size !== media.length) {
          throw new FixtureCollision(
            "BlobStore did not confirm the expected synthetic media identity.",
          );
        }

        const audit = await tx.auditEvent.create({
          data: {
            category: "register_action",
            action: FIXTURE_AUDIT_ACTION,
            severity: "NOTICE",
            subjectKind: "Meeting",
            subjectId: String(meetingId),
            actorKind: "operator",
            schemaVersion: "1.0",
            decision: "seeded",
            reasonLog: JSON.stringify([
              "governed_staging_fixture",
              "synthetic_non_customer_media",
            ]),
            payloadJson: JSON.stringify({
              fixtureVersion: FIXTURE_VERSION,
              classification: FIXTURE_CLASSIFICATION,
              bidId,
              meetingId,
              mediaFileName,
              mediaBytes: media.length,
              mediaSha256,
              applicationRevision: runtimeRevision,
            }),
          },
        });
        return {
          outcome: "created" as const,
          bidId,
          meetingId,
          auditId: audit.id,
          seededAt: audit.emittedAt.toISOString(),
          seedApplicationRevision: runtimeRevision,
          mediaSha256,
          mediaBytes: media.length,
        };
      } catch (caught) {
        if (blobWriteAttempted) {
          const stat = await deps.blobStore.stat(allocatedKey);
          if (stat && (stat.sha256 !== mediaSha256 || stat.size !== media.length)) {
            throw new CleanupProofFailure(
              "Unable to prove the failed BlobStore allocation belongs to this run.",
            );
          }
          const otherReference = await tx.meeting.findFirst({
            where: { audioStorageKey: allocatedKey, id: { not: meetingId } },
            select: { id: true },
          });
          if (stat && otherReference === null) {
            try {
              await deps.blobStore.delete(allocatedKey);
              blobCompensated = true;
            } catch {
              throw new CleanupProofFailure(
                "Unable to clean the unreferenced failed fixture blob.",
              );
            }
          }
        }
        throw caught;
      }
    });
    transactionCommitted = true;
    return result;
  } catch (caught) {
    if (blobWriteAttempted && !blobCompensated && !transactionCommitted) {
      const stat = await deps.blobStore.stat(allocatedKey);
      if (stat && (stat.sha256 !== mediaSha256 || stat.size !== media.length)) {
        throw new CleanupProofFailure(
          "Unable to prove the failed BlobStore allocation belongs to this run.",
        );
      }
      let reference: { id: number } | null;
      try {
        reference = await deps.prisma.meeting.findFirst({
          where: { audioStorageKey: allocatedKey },
          select: { id: true },
        });
      } catch {
        throw new CleanupProofFailure("Unable to prove the failed write is unreferenced.");
      }
      if (stat && reference === null) {
        try {
          await deps.blobStore.delete(allocatedKey);
        } catch {
          throw new CleanupProofFailure("Unable to clean the unreferenced failed fixture blob.");
        }
      }
    }
    throw caught;
  }
}

function buildManifest(result: SeedResult): FixtureManifest {
  return {
    schemaVersion: 1,
    fixtureVersion: FIXTURE_VERSION,
    classification: FIXTURE_CLASSIFICATION,
    bidId: result.bidId,
    meetingId: result.meetingId,
    auditEventId: result.auditId,
    mediaFileName: FIXTURE_MEDIA_FILE_NAME,
    mediaBytes: result.mediaBytes,
    mediaSha256: result.mediaSha256,
    seedApplicationRevision: result.seedApplicationRevision,
    seededAt: result.seededAt,
  };
}

function manifestReservationContent(
  bidId: number,
  meetingId: number,
  expectedRevision: string,
): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      state: "RESERVED_NOT_EVIDENCE",
      fixtureVersion: FIXTURE_VERSION,
      bidId,
      meetingId,
      expectedRevision,
    },
    null,
    2,
  )}\n`;
}

async function assertManifestPathIdentity(preflight: ManifestPreflight): Promise<void> {
  const current = await fs.lstat(preflight.path);
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    current.dev !== preflight.device ||
    current.ino !== preflight.inode
  ) {
    throw new GateRefusal("Manifest destination identity changed during execution.");
  }
}

async function preflightManifest(
  manifestPath: string,
  bidId: number,
  meetingId: number,
  expectedRevision: string,
): Promise<ManifestPreflight> {
  const parent = path.dirname(manifestPath);
  const parentStat = await fs.stat(parent);
  if (!parentStat.isDirectory()) throw new GateRefusal("Manifest parent is not a directory.");

  try {
    const handle = await fs.open(
      manifestPath,
      fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
    );
    try {
      const existingStat = await handle.stat();
      if (!existingStat.isFile() || (existingStat.mode & 0o777) !== 0o600) {
        throw new GateRefusal(
          "Manifest destination must be a mode-0600 regular file.",
        );
      }
      return {
        path: manifestPath,
        handle,
        device: existingStat.dev,
        inode: existingStat.ino,
        existingContent: await handle.readFile("utf8"),
        createdByThisRun: false,
      };
    } catch (caught) {
      await handle.close().catch(() => undefined);
      throw caught;
    }
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }

  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(
      manifestPath,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_RDWR |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "EEXIST") {
      throw new GateRefusal("Manifest destination was claimed by another execution.");
    }
    throw caught;
  }
  const createdStat = await handle.stat();
  try {
    const reservation = manifestReservationContent(bidId, meetingId, expectedRevision);
    await handle.writeFile(reservation, "utf8");
    await handle.sync();
    return {
      path: manifestPath,
      handle,
      device: createdStat.dev,
      inode: createdStat.ino,
      existingContent: null,
      createdByThisRun: true,
    };
  } catch (caught) {
    await handle.close().catch(() => undefined);
    try {
      const current = await fs.lstat(manifestPath);
      if (current.dev === createdStat.dev && current.ino === createdStat.ino) {
        await fs.unlink(manifestPath);
      }
    } catch {
      // The original failure remains authoritative; an orphan reservation is fail-closed.
    }
    throw caught;
  }
}

async function writeContentThroughHandle(
  handle: Awaited<ReturnType<typeof fs.open>>,
  content: string,
): Promise<void> {
  const bytes = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (written.bytesWritten <= 0) throw new Error("Manifest write made no progress.");
    offset += written.bytesWritten;
  }
  await handle.truncate(bytes.length);
}

async function writeManifestSecurely(
  preflight: ManifestPreflight,
  manifest: FixtureManifest,
  outcome: SeedResult["outcome"],
): Promise<void> {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await assertManifestPathIdentity(preflight);

  if (preflight.existingContent === content) return;
  const recoverableReservation = manifestReservationContent(
    manifest.bidId,
    manifest.meetingId,
    manifest.seedApplicationRevision,
  );
  if (
    preflight.existingContent !== null &&
    (outcome !== "already_present" || preflight.existingContent !== recoverableReservation)
  ) {
    throw new GateRefusal("Manifest destination already contains different evidence.");
  }

  await writeContentThroughHandle(preflight.handle, content);
  await preflight.handle.chmod(0o600);
  await preflight.handle.sync();
  await assertManifestPathIdentity(preflight);
}

async function closeManifestPreflight(
  preflight: ManifestPreflight | null,
  preserve: boolean,
): Promise<void> {
  if (!preflight) return;
  try {
    if (preflight.createdByThisRun && !preserve) {
      try {
        await assertManifestPathIdentity(preflight);
        await fs.unlink(preflight.path);
      } catch (caught) {
        if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
      }
    }
  } finally {
    await preflight.handle.close();
  }
}

const MAX_ERROR_DESCRIPTOR_LENGTH = 64;
const ERRNO_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function sanitizeErrorDescriptor(caught: unknown): string {
  const code =
    caught && typeof caught === "object" && "code" in caught
      ? (caught as { code?: unknown }).code
      : undefined;
  if (typeof code === "string" && ERRNO_CODE_PATTERN.test(code)) {
    return code.slice(0, MAX_ERROR_DESCRIPTOR_LENGTH);
  }
  if (caught instanceof Error) {
    return caught.constructor.name.slice(0, MAX_ERROR_DESCRIPTOR_LENGTH);
  }
  return typeof caught;
}

function printPlan(args: ParsedArgs): void {
  log("DRY RUN — fixture seeding remains disabled and no Prisma or BlobStore calls will be made.");
  log(
    `Would verify pre-existing exact fixture ids bidId=${args.bidId ?? "<required>"} ` +
      `meetingId=${args.meetingId ?? "<required>"}; the seeder never creates those rows.`,
  );
  log("Would generate a deterministic one-second silent WAV, attach it through BlobStore, and leave the Meeting PENDING.");
  log("Would append one durable audit event and write a mode-0600 non-secret manifest.");
  log("Stop on any environment, revision, database classification, identity, media, audit, or manifest collision.");
}

export async function runMain(
  argv: string[],
  options: {
    env?: RuntimeEnvironment;
    dependencies?: SeederDependencies;
  } = {},
): Promise<number> {
  const args = parseArgv(argv);
  if (args.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (args.errors.length > 0) {
    for (const message of args.errors) err(message);
    return 1;
  }
  if (!args.apply) {
    printPlan(args);
    return 0;
  }

  let manifestPreflight: ManifestPreflight | null = null;
  let preserveManifest = false;
  let exitCode: number;
  try {
    const runtimeEnv = options.env ?? process.env;
    const runtimeRevision = assertApplyGates(args, runtimeEnv);
    log("Staging environment, explicit enablement, runtime revision, and database classification: PASS.");
    manifestPreflight = await preflightManifest(
      args.manifest!,
      args.bidId!,
      args.meetingId!,
      runtimeRevision,
    );
    const dependencies = options.dependencies ?? (await loadDefaultDependencies());
    const result = await createOrVerifyFixture(
      dependencies,
      runtimeRevision,
      args.bidId!,
      args.meetingId!,
      manifestPreflight.existingContent !== null,
    );
    preserveManifest = true;
    await writeManifestSecurely(manifestPreflight, buildManifest(result), result.outcome);
    log(
      `${result.outcome === "created" ? "Fixture created" : "Fixture already present"}. ` +
        `bidId=${result.bidId} meetingId=${result.meetingId} mediaSha256=${result.mediaSha256}`,
    );
    log("Manifest evidence written with mode 0600. No queue or provider action was invoked.");
    exitCode = 0;
  } catch (caught) {
    if (caught instanceof GateRefusal || caught instanceof FixtureCollision) {
      err(caught.message);
      exitCode = 1;
    } else {
      err(`Unexpected failure: ${sanitizeErrorDescriptor(caught)}`);
      exitCode = 2;
    }
  }
  try {
    await closeManifestPreflight(manifestPreflight, preserveManifest);
  } catch (caught) {
    err(`Manifest reservation cleanup failed: ${sanitizeErrorDescriptor(caught)}`);
    return 2;
  }
  return exitCode;
}

const invokedAsScript =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  runMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((caught) => {
      err(`Unexpected bootstrap failure: ${sanitizeErrorDescriptor(caught)}`);
      process.exitCode = 2;
    });
}
