import {
  MEETING_INTELLIGENCE_CANDIDATE_TYPES,
  type MeetingIntelligenceCandidateType,
} from "./types";

export const TASK_ELIGIBLE_CANDIDATE_TYPES = [
  "ACTION_ITEM",
  "OWNER_COMMITMENT",
  "CONTRACTOR_COMMITMENT",
  "CLOSEOUT_ITEM",
  "WARRANTY_ITEM",
  "RFI_OR_CLARIFICATION",
  "ISSUE",
  "RISK",
] as const satisfies readonly MeetingIntelligenceCandidateType[];

export const CONTEXT_ONLY_CANDIDATE_TYPES = [
  "DECISION",
  "DUE_DATE",
  "SPEC_REFERENCE",
] as const satisfies readonly MeetingIntelligenceCandidateType[];

export type ReviewLedgerCandidate = {
  id: number;
  segmentId: number | null;
  candidateType: string;
  rawText: string;
  draftText: string;
  evidenceExcerpt: string;
  speakerLabel: string;
  startSec: number | null;
  endSec: number | null;
  confidence: number | null;
  dueDate: string | Date | null;
  reviewState: string;
};

export type ReviewLedgerSegment = {
  id: number;
  currentSpeakerLabel: string;
  currentText: string;
  startSec: number | null;
  endSec: number | null;
};

export type ReviewLedgerFilters = {
  state?: string;
  type?: string;
  actionability?: "all" | "task" | "context";
  due?: "all" | "missing" | "overdue" | "next7";
  search?: string;
};

export type ReviewLedgerGroup<T extends ReviewLedgerCandidate = ReviewLedgerCandidate> = {
  key: string;
  segment: ReviewLedgerSegment | null;
  evidenceExcerpt: string;
  speakerLabel: string;
  startSec: number | null;
  endSec: number | null;
  confidence: number | null;
  candidates: T[];
};

export function isTaskEligibleCandidateType(type: string): boolean {
  return (TASK_ELIGIBLE_CANDIDATE_TYPES as readonly string[]).includes(type);
}

function evidenceHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fallbackGroupKey(candidate: ReviewLedgerCandidate): string {
  const excerpt = candidate.evidenceExcerpt.trim().toLowerCase().replaceAll(/\s+/g, " ");
  return `evidence:${candidate.startSec ?? "unknown"}:${candidate.endSec ?? "unknown"}:${evidenceHash(excerpt)}`;
}

export function groupMeetingIntelligenceCandidates<T extends ReviewLedgerCandidate>(
  candidates: T[],
  segments: ReviewLedgerSegment[],
): ReviewLedgerGroup<T>[] {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const groups = new Map<string, ReviewLedgerGroup<T>>();

  for (const candidate of candidates) {
    const segment = candidate.segmentId == null ? null : segmentById.get(candidate.segmentId) ?? null;
    const key = candidate.segmentId == null ? fallbackGroupKey(candidate) : `segment:${candidate.segmentId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.candidates.push(candidate);
      continue;
    }
    groups.set(key, {
      key,
      segment,
      evidenceExcerpt: candidate.evidenceExcerpt,
      speakerLabel: segment?.currentSpeakerLabel ?? candidate.speakerLabel,
      startSec: segment?.startSec ?? candidate.startSec,
      endSec: segment?.endSec ?? candidate.endSec,
      confidence: candidate.confidence,
      candidates: [candidate],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      candidates: [...group.candidates].sort((left, right) => {
        const actionability = Number(isTaskEligibleCandidateType(right.candidateType)) -
          Number(isTaskEligibleCandidateType(left.candidateType));
        return actionability || left.id - right.id;
      }),
    }))
    .sort((left, right) => {
      const leftActionable = left.candidates.some((candidate) => isTaskEligibleCandidateType(candidate.candidateType));
      const rightActionable = right.candidates.some((candidate) => isTaskEligibleCandidateType(candidate.candidateType));
      return Number(rightActionable) - Number(leftActionable) ||
        (left.startSec ?? Number.MAX_SAFE_INTEGER) - (right.startSec ?? Number.MAX_SAFE_INTEGER) ||
        left.key.localeCompare(right.key);
    });
}

export function filterMeetingIntelligenceCandidates<T extends ReviewLedgerCandidate>(
  candidates: T[],
  filters: ReviewLedgerFilters,
  now = new Date(),
): T[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000);
  return candidates.filter((candidate) => {
    if (filters.state && filters.state !== "all" && candidate.reviewState !== filters.state) return false;
    if (filters.type && filters.type !== "all" && candidate.candidateType !== filters.type) return false;
    const taskEligible = isTaskEligibleCandidateType(candidate.candidateType);
    if (filters.actionability === "task" && !taskEligible) return false;
    if (filters.actionability === "context" && taskEligible) return false;
    const dueDate = candidate.dueDate ? new Date(candidate.dueDate) : null;
    if (filters.due === "missing" && dueDate) return false;
    if (filters.due === "overdue" && (!dueDate || dueDate >= now)) return false;
    if (filters.due === "next7" && (!dueDate || dueDate < now || dueDate > sevenDays)) return false;
    if (search && ![
      candidate.draftText,
      candidate.rawText,
      candidate.evidenceExcerpt,
      candidate.speakerLabel,
      candidate.candidateType,
    ].some((value) => value.toLowerCase().includes(search))) return false;
    return true;
  });
}

export function candidateDispositionCounts(candidates: ReviewLedgerCandidate[]): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.reviewState] = (counts[candidate.reviewState] ?? 0) + 1;
    return counts;
  }, {});
}

export function isCandidateTypeFilter(value: string): boolean {
  return value === "all" || (MEETING_INTELLIGENCE_CANDIDATE_TYPES as readonly string[]).includes(value);
}
