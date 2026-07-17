// lib/services/meetingRegister/registerBuilder.ts
//
// Module R2-B1 — deterministic projection: MeetingAnalysis → Meeting
// Register entry drafts. NO provider call happens here — this consumes the
// already-parsed analysis (sections 4/5/6/7/9/10) and is fully local and
// testable. Bridge entries (ACTION_ITEM / COMMITMENT / DESIGN_CHANGE) link
// to the lifecycle rows the analysis writer created; they never mirror
// those rows' lifecycle. DISCUSSION / CONSTRAINT / SCHEDULE_ITEM /
// PROCUREMENT_ITEM / INFORMATIONAL entries are manual-only in Build 1
// (extending the provider prompt is a separately-gated change).

import type { MeetingAnalysis, WriteMeetingAnalysisResult } from "@/lib/meeting-analysis";
import type { EntryOrigin, RegisterEntryType } from "./types";

export type RegisterEntryDraft = {
  entryType: RegisterEntryType;
  agendaTopic: string | null;
  rawSourceText: string;
  normalizedText: string;
  speakerLabel: string | null;
  speakerName: string | null;
  responsibleParty: string | null;
  dueDate: Date | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  origin: EntryOrigin;
  linkedActionItemId: number | null;
  linkedCommitmentId: number | null;
  linkedDesignChangeId: number | null;
};

const clampText = (v: string, max = 4000) => v.trim().slice(0, max);

function parseIsoDate(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return new Date(`${v}T00:00:00.000Z`);
}

/**
 * Deterministic mapping (same input → same drafts, same order):
 *   §4 key decisions   → DECISION           (ai_extraction)
 *   §5 action items    → ACTION_ITEM        (action_item_bridge)
 *   §6 open issues     → QUESTION           (ai_extraction)
 *   §7 red flags       → RISK               (ai_extraction)
 *   §9 design changes  → DESIGN_CHANGE      (design_change_bridge)
 *   §10 commitments    → COMMITMENT         (commitment_bridge)
 * Confidence: HIGH when verbatim/paraphrased source text accompanied the
 * item, MEDIUM otherwise.
 */
export function buildRegisterDrafts(
  analysis: MeetingAnalysis,
  writeResult: WriteMeetingAnalysisResult
): RegisterEntryDraft[] {
  const drafts: RegisterEntryDraft[] = [];

  for (const decision of analysis.section4) {
    const text = clampText(String(decision));
    if (!text) continue;
    drafts.push({
      entryType: "DECISION",
      agendaTopic: null,
      rawSourceText: text,
      normalizedText: text,
      speakerLabel: null,
      speakerName: null,
      responsibleParty: null,
      dueDate: null,
      confidence: "MEDIUM",
      origin: "ai_extraction",
      linkedActionItemId: null,
      linkedCommitmentId: null,
      linkedDesignChangeId: null,
    });
  }

  analysis.section5.forEach((item, i) => {
    const task = clampText(item.task);
    if (!task) return;
    drafts.push({
      entryType: "ACTION_ITEM",
      agendaTopic: null,
      rawSourceText: clampText(item.evidenceText ?? item.task),
      normalizedText: task,
      speakerLabel: null,
      speakerName: item.person || null,
      responsibleParty: item.person || null,
      dueDate: parseIsoDate(item.dueDate),
      confidence: item.evidenceText ? "HIGH" : "MEDIUM",
      origin: "action_item_bridge",
      linkedActionItemId: writeResult.actionItemIds[i] ?? null,
      linkedCommitmentId: null,
      linkedDesignChangeId: null,
    });
  });

  for (const issue of analysis.section6) {
    const text = clampText(issue.text);
    if (!text) continue;
    drafts.push({
      entryType: "QUESTION",
      agendaTopic: null,
      rawSourceText: clampText(issue.reason ? `${issue.text} — ${issue.reason}` : issue.text),
      normalizedText: text,
      speakerLabel: null,
      speakerName: null,
      responsibleParty: null,
      dueDate: null,
      confidence: "MEDIUM",
      origin: "ai_extraction",
      linkedActionItemId: null,
      linkedCommitmentId: null,
      linkedDesignChangeId: null,
    });
  }

  for (const flag of analysis.section7) {
    const text = clampText(flag.description);
    if (!text) continue;
    drafts.push({
      entryType: "RISK",
      agendaTopic: flag.tag,
      rawSourceText: text,
      normalizedText: text,
      speakerLabel: null,
      speakerName: null,
      responsibleParty: null,
      dueDate: null,
      confidence: "MEDIUM",
      origin: "ai_extraction",
      linkedActionItemId: null,
      linkedCommitmentId: null,
      linkedDesignChangeId: null,
    });
  }

  analysis.section9.forEach((change, i) => {
    drafts.push({
      entryType: "DESIGN_CHANGE",
      agendaTopic: change.affectedSpec,
      rawSourceText: clampText(change.sourceQuote ?? change.changeText),
      normalizedText: clampText(change.changeText),
      speakerLabel: change.speakerLabel,
      speakerName: null,
      responsibleParty: null,
      dueDate: null,
      confidence: change.sourceQuote ? "HIGH" : "MEDIUM",
      origin: "design_change_bridge",
      linkedActionItemId: null,
      linkedCommitmentId: null,
      linkedDesignChangeId: writeResult.designChangeIds[i] ?? null,
    });
  });

  analysis.section10.forEach((commitment, i) => {
    drafts.push({
      entryType: "COMMITMENT",
      agendaTopic: null,
      rawSourceText: clampText(commitment.sourceQuote ?? commitment.commitmentText),
      normalizedText: clampText(commitment.commitmentText),
      speakerLabel: commitment.speakerLabel,
      speakerName: commitment.committedBy,
      responsibleParty: commitment.committedBy,
      dueDate: parseIsoDate(commitment.dueDate),
      confidence: commitment.sourceQuote ? "HIGH" : "MEDIUM",
      origin: "commitment_bridge",
      linkedActionItemId: null,
      linkedCommitmentId: writeResult.commitmentIds[i] ?? null,
      linkedDesignChangeId: null,
    });
  });

  return drafts;
}

export type SegmentAnchor = {
  id: number;
  startSec: number | null;
  endSec: number | null;
  currentSpeakerLabel: string | null;
  currentText: string;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function formatCitation(seg: SegmentAnchor): string {
  const label = seg.currentSpeakerLabel ?? "[UNKNOWN]";
  if (seg.startSec == null) return label;
  const total = Math.max(0, Math.floor(seg.startSec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const ts = h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
  return `[${ts}] ${label}`;
}

/**
 * Anchor drafts whose raw wording appears VERBATIM in exactly one segment
 * (verbatim source quotes from §9/§10 usually do). Ambiguous or absent
 * matches stay unanchored — never guess a citation.
 */
export function anchorDraftsToSegments<T extends RegisterEntryDraft>(
  drafts: T[],
  segments: SegmentAnchor[]
): Array<T & { segmentId: number | null; startSec: number | null; endSec: number | null; sourceCitation: string | null }> {
  return drafts.map((draft) => {
    const needle = norm(draft.rawSourceText);
    let match: SegmentAnchor | null = null;
    if (needle.length >= 12) {
      const hits = segments.filter((s) => norm(s.currentText).includes(needle));
      if (hits.length === 1) match = hits[0];
    }
    return {
      ...draft,
      segmentId: match?.id ?? null,
      startSec: match?.startSec ?? null,
      endSec: match?.endSec ?? null,
      sourceCitation: match ? formatCitation(match) : draft.speakerLabel,
    };
  });
}
