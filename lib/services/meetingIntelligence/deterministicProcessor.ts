import {
  LOCAL_ONLY_CONFIDENTIALITY,
  LOCAL_PROCESSOR_KIND,
  LOCAL_PROCESSOR_VERSION,
  UNKNOWN_SPEAKER,
  isCandidateType,
  normalizeSpeakerLabel,
  type MeetingIntelligenceCandidateType,
} from "./types";

export type DeterministicTranscriptSegment = {
  segmentIndex: number;
  startSec: number | null;
  endSec: number | null;
  speakerLabel: string;
  text: string;
  confidence: number;
};

export type DeterministicCandidate = {
  segmentIndex: number;
  candidateType: MeetingIntelligenceCandidateType;
  rawText: string;
  draftText: string;
  evidenceExcerpt: string;
  speakerLabel: string;
  startSec: number | null;
  endSec: number | null;
  confidence: number;
  dueDate: Date | null;
};

export type DeterministicMeetingIntelligence = {
  transcriptText: string;
  transcriptConfidence: number;
  sourceMetadataJson: string;
  segments: DeterministicTranscriptSegment[];
  candidates: DeterministicCandidate[];
};

const LINE_PATTERN =
  /^\s*(?:\[([^\]]+)\]\s*)?(?:(SPEAKER[_ ]?\d+|UNKNOWN(?:_SPEAKER)?)\s*:\s*)?(.+?)\s*$/i;
const CANDIDATE_PATTERN =
  /^(?:\[([A-Z_]+)\]|([A-Z_]+)\s*:)\s*(.+)$/;
const ISO_DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/;

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isFinite(part) || part < 0)
  ) {
    return null;
  }
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseDueDate(text: string): Date | null {
  const match = text.match(ISO_DATE_PATTERN)?.[1];
  if (!match) return null;
  const date = new Date(`${match}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Deterministic development processor. It recognizes one explicit candidate
 * marker per non-empty line, for example:
 *   [00:12] SPEAKER_1: ACTION_ITEM: Submit the RFI by 2026-07-24
 *   [00:20] SPEAKER_2: [DECISION] Use the alternate flashing detail
 *
 * It performs no media decoding, model inference, network request, or external
 * AI call. The explicit marker contract keeps fixtures reproducible and honest.
 */
export function processDeterministicMeetingFixture(
  fixtureText: string,
): DeterministicMeetingIntelligence {
  const boundedText = fixtureText.trim().slice(0, 200_000);
  if (!boundedText) throw new Error("Fixture transcript text is required");

  const segments: DeterministicTranscriptSegment[] = boundedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, segmentIndex) => {
      const match = line.match(LINE_PATTERN);
      const text = match?.[3]?.trim() || line;
      const speakerLabel = normalizeSpeakerLabel(match?.[2]);
      return {
        segmentIndex,
        startSec: parseTimestamp(match?.[1]),
        endSec: null,
        speakerLabel,
        text,
        confidence: speakerLabel === UNKNOWN_SPEAKER ? 0.5 : 0.95,
      };
    });

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index].startSec != null && segments[index + 1].startSec != null) {
      segments[index].endSec = segments[index + 1].startSec;
    }
  }

  const candidates: DeterministicCandidate[] = [];
  for (const segment of segments) {
    const match = segment.text.match(CANDIDATE_PATTERN);
    const rawType = match?.[1] ?? match?.[2];
    const body = match?.[3]?.trim();
    if (!rawType || !body || !isCandidateType(rawType)) continue;
    candidates.push({
      segmentIndex: segment.segmentIndex,
      candidateType: rawType,
      rawText: body,
      draftText: body,
      evidenceExcerpt: segment.text.slice(0, 2_000),
      speakerLabel: segment.speakerLabel,
      startSec: segment.startSec,
      endSec: segment.endSec,
      confidence: 0.95,
      dueDate: parseDueDate(body),
    });
  }

  return {
    transcriptText: boundedText,
    transcriptConfidence:
      segments.reduce((sum, segment) => sum + segment.confidence, 0) /
      segments.length,
    sourceMetadataJson: JSON.stringify({
      processor: LOCAL_PROCESSOR_KIND,
      processorVersion: LOCAL_PROCESSOR_VERSION,
      confidentiality: LOCAL_ONLY_CONFIDENTIALITY,
      input: "explicitly-tagged-fixture-text",
      realAi: false,
    }),
    segments,
    candidates,
  };
}
