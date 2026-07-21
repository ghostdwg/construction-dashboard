import {
  HEURISTIC_EXTRACTOR_VERSION,
  LOCAL_ONLY_CONFIDENTIALITY,
  UNKNOWN_SPEAKER,
  normalizeSpeakerLabel,
  type MeetingIntelligenceCandidateType,
} from "./types";

export type WorkerTranscriptSegment = {
  segmentIndex: number;
  startSec: number | null;
  endSec: number | null;
  text: string;
  speakerLabel: string;
  confidence: number | null;
};

export type HeuristicCandidate = {
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

const ISO_DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/;

const RULES: ReadonlyArray<{
  type: MeetingIntelligenceCandidateType;
  pattern: RegExp;
}> = [
  { type: "WARRANTY_ITEM", pattern: /\bwarrant(?:y|ies|ied)\b/i },
  { type: "CLOSEOUT_ITEM", pattern: /\b(closeout|close-out|o\s*&\s*m|as-built|training record)\b/i },
  { type: "SPEC_REFERENCE", pattern: /\b(spec(?:ification)?\s+(?:section\s+)?\d{2}(?:\s|\d|\.)+|division\s+\d{1,2})\b/i },
  { type: "RFI_OR_CLARIFICATION", pattern: /\b(rfi|clarif(?:y|ication)|need(?:s)? an answer|open question)\b/i },
  { type: "OWNER_COMMITMENT", pattern: /\b(owner|client)\b.{0,80}\b(will|shall|committed|agreed|provide)\b/i },
  { type: "CONTRACTOR_COMMITMENT", pattern: /\b(contractor|gc|general contractor|subcontractor)\b.{0,80}\b(will|shall|committed|agreed|provide)\b/i },
  { type: "DECISION", pattern: /\b(decided|decision is|agreed to|approved|selected|will use|proceed with)\b/i },
  { type: "RISK", pattern: /\b(risk|may delay|could delay|long[- ]lead|exposure|threatens?)\b/i },
  { type: "ISSUE", pattern: /\b(issue|problem|blocked|conflict|defect|not working)\b/i },
  { type: "DUE_DATE", pattern: /\b(due|deadline|no later than|by)\b.{0,40}\b\d{4}-\d{2}-\d{2}\b/i },
  { type: "ACTION_ITEM", pattern: /\b(action item|follow up|please|need to|needs to|will (?:send|submit|provide|prepare|coordinate|review|confirm)|submit|provide|prepare|coordinate)\b/i },
];

function dueDate(text: string): Date | null {
  const value = text.match(ISO_DATE_PATTERN)?.[1];
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Transparent, deterministic structural extraction for worker-submitted text.
 * It performs no model inference and creates reviewable DRAFT candidates only.
 */
export function extractMeetingStructure(
  segments: WorkerTranscriptSegment[],
): { candidates: HeuristicCandidate[]; sourceMetadataJson: string } {
  const candidates: HeuristicCandidate[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const matched = new Set<MeetingIntelligenceCandidateType>();
    for (const rule of RULES) {
      if (!rule.pattern.test(text) || matched.has(rule.type)) continue;
      matched.add(rule.type);
      candidates.push({
        segmentIndex: segment.segmentIndex,
        candidateType: rule.type,
        rawText: text,
        draftText: text,
        evidenceExcerpt: text.slice(0, 2_000),
        speakerLabel: normalizeSpeakerLabel(segment.speakerLabel) || UNKNOWN_SPEAKER,
        startSec: segment.startSec,
        endSec: segment.endSec,
        confidence: 0.7,
        dueDate: dueDate(text),
      });
    }
  }
  return {
    candidates,
    sourceMetadataJson: JSON.stringify({
      extractor: "deterministic_keyword_rules",
      extractorVersion: HEURISTIC_EXTRACTOR_VERSION,
      confidentiality: LOCAL_ONLY_CONFIDENTIALITY,
      realAi: false,
      humanReviewRequired: true,
    }),
  };
}
