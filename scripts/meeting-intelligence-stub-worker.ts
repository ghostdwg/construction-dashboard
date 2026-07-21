#!/usr/bin/env tsx
/**
 * Deterministic local development worker. It exercises the exact authenticated
 * worker HTTP contract but performs no transcription, model inference, GPU
 * work, or external-provider call. Run only against a local dev server:
 *
 *   MEETING_WORKER_TOKEN=<local-test-value> npm run worker:meeting-stub
 *
 * Set MEETING_STUB_FIXTURE=fail to exercise bounded failure/retry behavior.
 */
import { createHash } from "node:crypto";
import {
  computeMeetingIntelligenceResultChecksum,
} from "@/lib/services/meetingIntelligence/workerContract";
import type { WorkerTranscriptSegment } from "@/lib/services/meetingIntelligence/heuristicExtractor";

const baseUrl = process.env.MEETING_WORKER_BASE_URL ?? "http://127.0.0.1:3000";
const workerToken = process.env.MEETING_WORKER_TOKEN;
const workerId = process.env.MEETING_STUB_WORKER_ID ?? "meeting-intelligence-stub-local";
const fixture = process.env.MEETING_STUB_FIXTURE ?? "success";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/i.test(baseUrl)) {
  throw new Error("The stub worker is local-only; MEETING_WORKER_BASE_URL must use localhost or 127.0.0.1");
}
if (!workerToken) throw new Error("MEETING_WORKER_TOKEN is required and must match the local app process");

const authHeaders = {
  "Content-Type": "application/json",
  "X-Meeting-Worker-Token": workerToken,
};

async function jsonPost(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `Stub worker request failed (${response.status}): ${String(json.error ?? json.reason ?? "unknown")}`,
    );
  }
  return json;
}

const claim = await jsonPost("/api/worker/meeting-intelligence/claim", { workerId });
if (claim.jobId == null) {
  process.stdout.write("No Meeting Intelligence worker job is queued.\n");
  process.exit(0);
}

const jobId = Number(claim.jobId);
const leaseToken = String(claim.leaseToken);
await jsonPost(`/api/worker/meeting-intelligence/${jobId}/heartbeat`, { leaseToken });
await jsonPost(`/api/worker/meeting-intelligence/${jobId}/progress`, {
  leaseToken,
  stage: "media_fetch",
  percent: 10,
});

const media = await fetch(`${baseUrl}${String(claim.mediaDownloadUrl)}`, {
  headers: {
    "X-Meeting-Worker-Token": workerToken,
    "X-Meeting-Worker-Lease": leaseToken,
  },
});
if (!media.ok) throw new Error(`Stub worker media download failed (${media.status})`);
const mediaBytes = Buffer.from(await media.arrayBuffer());
const sourceMediaChecksum = createHash("sha256").update(mediaBytes).digest("hex");
if (sourceMediaChecksum !== media.headers.get("x-content-sha256")) {
  throw new Error("Stub worker media checksum did not match the application header");
}

if (fixture === "fail") {
  await jsonPost(`/api/worker/meeting-intelligence/${jobId}/fail`, {
    leaseToken,
    errorCode: "STUB_FIXTURE_FAILURE",
    errorMessage: "Deterministic stub failure requested for bounded retry validation",
  });
  process.stdout.write(`Stub worker reported deterministic failure for job ${jobId}.\n`);
  process.exit(0);
}

await jsonPost(`/api/worker/meeting-intelligence/${jobId}/progress`, {
  leaseToken,
  stage: "transcribe",
  percent: 65,
});

const transcriptText = [
  `STUB LOCAL WORKER JOB ${jobId}. This is canned development output, not AI transcription.`,
  "The contractor will submit the revised RFI response by 2026-07-30.",
  "The team decided to use the alternate flashing detail.",
].join("\n");
const segments: WorkerTranscriptSegment[] = [
  {
    segmentIndex: 0,
    startSec: 0,
    endSec: 4,
    text: `STUB LOCAL WORKER JOB ${jobId}. This is canned development output, not AI transcription.`,
    speakerLabel: "UNKNOWN_SPEAKER",
    confidence: 1,
  },
  {
    segmentIndex: 1,
    startSec: 4,
    endSec: 9,
    text: "The contractor will submit the revised RFI response by 2026-07-30.",
    speakerLabel: "SPEAKER_1",
    confidence: 1,
  },
  {
    segmentIndex: 2,
    startSec: 9,
    endSec: 13,
    text: "The team decided to use the alternate flashing detail.",
    speakerLabel: "SPEAKER_2",
    confidence: 1,
  },
];
const toolVersions = {
  transcriptionTool: "groundworx-deterministic-stub",
  transcriptionModel: "canned-fixture",
  transcriptionVersion: "1",
  diarizationTool: "groundworx-deterministic-stub",
  diarizationModel: "fixed-speaker-labels",
  diarizationVersion: "1",
};
const rawArtifact = {
  status: "stub",
  realAi: false,
  source: "deterministic-canned-development-output",
};
const resultChecksum = computeMeetingIntelligenceResultChecksum({
  transcriptText,
  segments,
  toolVersions,
  rawArtifactJson: JSON.stringify(rawArtifact),
});

await jsonPost(`/api/worker/meeting-intelligence/${jobId}/progress`, {
  leaseToken,
  stage: "persist",
  percent: 95,
});
await jsonPost(`/api/worker/meeting-intelligence/${jobId}/complete`, {
  leaseToken,
  transcriptText,
  segments,
  sourceMediaChecksum,
  resultChecksum,
  toolVersions,
  rawArtifact,
});
process.stdout.write(`Stub worker completed job ${jobId} with deterministic canned output.\n`);
