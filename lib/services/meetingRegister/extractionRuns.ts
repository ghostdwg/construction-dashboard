// lib/services/meetingRegister/extractionRuns.ts
//
// Module R2-B1 — extraction runs: the preview/apply lifecycle for analysis
// → register projection (R2 rules 7–8).
//
// The FIRST run for a meeting applies immediately (initial population —
// there is nothing to preview against). Every later run lands PREVIEWED
// holding the parsed analysis; a human applies or discards it.
//
// APPLY NEVER DELETES. Reconciliation is deterministic and idempotent:
//   • UNCHANGED  — an identical re-extraction (same type + same raw source
//                  wording) keeps the existing PENDING entry, its id, its
//                  originating extraction run and its disposition state.
//   • CREATE     — a draft with no existing counterpart becomes a new entry.
//   • SUPERSEDE  — a PENDING machine-origin entry the new analysis no longer
//                  produces is marked reviewState=SUPERSEDED and retained
//                  forever (supersededByRunId, supersededByEntryId where a
//                  deterministic replacement match exists, supersededAt, and
//                  an append-only RERUN_SUPERSEDE revision row).
//   • MERGE      — two or more PENDING entries that map onto ONE new draft
//                  (same type + same anchor segment) are all superseded by
//                  that one created entry.
//   • PRESERVE   — dispositioned/linked/promoted entries are NEVER touched
//                  (freeze discipline; R2 rule 2).
// The mandatory AuditEvent row is written inside the same transaction
// (fail-closed); stdout telemetry is emitted only after commit.
// Nothing here calls a provider; the analysis JSON arrives from the
// analyze route.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  writeMeetingAnalysisTx,
  type MeetingAnalysis,
  type WriteMeetingAnalysisResult,
} from "@/lib/meeting-analysis";
import {
  buildRegisterDrafts,
  anchorDraftsToSegments,
  type RegisterEntryDraft,
} from "./registerBuilder";
import { emitRegisterAuditPostCommit, writeRegisterAuditTx } from "./txAudit";
import {
  EXTRACTED_ORIGINS,
  SUPERSEDED_STATE,
  actorLabel,
  type Actor,
  type ServiceResult,
} from "./types";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type RunOutcomeKind =
  | "create"
  | "unchanged"
  | "supersede"
  | "merge"
  | "preserve";

/** One reconcile outcome — ids/types only, never entry text. */
export type RunOutcome = {
  outcome: RunOutcomeKind;
  /** existing entry affected (unchanged/supersede/merge/preserve) */
  entryId?: number;
  /** draft position in the deterministic draft order (create/unchanged/supersede/merge) */
  draftIndex?: number;
  entryType: string;
};

export type RunPreview = {
  toAdd: number;
  unchanged: number;
  toSupersede: number;
  merged: number;
  preservedDispositioned: number;
  addByType: Record<string, number>;
  outcomes: RunOutcome[];
};

type AnchoredDraft = RegisterEntryDraft & {
  segmentId: number | null;
  startSec: number | null;
  endSec: number | null;
  sourceCitation: string | null;
};

type ExistingEntry = {
  id: number;
  entryType: string;
  rawSourceText: string;
  segmentId: number | null;
  reviewState: string;
  origin: string;
};

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Deterministic reconcile of the new drafts against the existing register.
 * Pure function — same inputs produce the same outcomes in the same order,
 * which is what makes preview honest and apply idempotent.
 *
 * Pass 1: exact identity (entryType + normalized rawSourceText) → UNCHANGED.
 * Pass 2: same entryType + same anchor segment → SUPERSEDE with replacement;
 *         additional existing entries collapsing onto the same draft → MERGE.
 * Pass 3: leftover PENDING machine entries → SUPERSEDE (no replacement);
 *         leftover drafts → CREATE. Dispositioned entries → PRESERVE.
 */
export function computeReconcile(
  existing: ExistingEntry[],
  drafts: AnchoredDraft[]
): RunOutcome[] {
  const outcomes: RunOutcome[] = [];
  const machinePending = existing
    .filter(
      (e) =>
        (EXTRACTED_ORIGINS as readonly string[]).includes(e.origin) &&
        e.reviewState === "PENDING"
    )
    .sort((a, b) => a.id - b.id);
  for (const e of existing) {
    if (e.reviewState !== "PENDING" && e.reviewState !== SUPERSEDED_STATE) {
      outcomes.push({ outcome: "preserve", entryId: e.id, entryType: e.entryType });
    }
  }

  const unmatchedExisting = new Map(machinePending.map((e) => [e.id, e]));
  const draftMatched = new Set<number>();

  // Pass 1 — identical re-extraction keeps the existing entry.
  const byIdentity = new Map<string, ExistingEntry[]>();
  for (const e of machinePending) {
    const key = `${e.entryType}::${normText(e.rawSourceText)}`;
    const q = byIdentity.get(key) ?? [];
    q.push(e);
    byIdentity.set(key, q);
  }
  drafts.forEach((d, i) => {
    const key = `${d.entryType}::${normText(d.rawSourceText)}`;
    const q = byIdentity.get(key);
    const hit = q?.find((e) => unmatchedExisting.has(e.id));
    if (hit) {
      unmatchedExisting.delete(hit.id);
      draftMatched.add(i);
      outcomes.push({
        outcome: "unchanged",
        entryId: hit.id,
        draftIndex: i,
        entryType: d.entryType,
      });
    }
  });

  // Pass 2 — same type + same anchor segment = replacement (changed wording).
  drafts.forEach((d, i) => {
    if (draftMatched.has(i) || d.segmentId == null) return;
    const hits = [...unmatchedExisting.values()]
      .filter((e) => e.entryType === d.entryType && e.segmentId === d.segmentId)
      .sort((a, b) => a.id - b.id);
    if (hits.length === 0) return;
    // This draft IS the replacement entry (created once in reconcile). Mark it
    // matched so pass 3 does NOT also emit a CREATE for it — otherwise the same
    // changed-wording draft was double-classified as both SUPERSEDE and CREATE
    // and `toAdd` overcounted the single row reconcile actually creates.
    draftMatched.add(i);
    hits.forEach((e, hitIndex) => {
      unmatchedExisting.delete(e.id);
      outcomes.push({
        outcome: hitIndex === 0 ? "supersede" : "merge",
        entryId: e.id,
        draftIndex: i,
        entryType: e.entryType,
      });
    });
  });

  // Pass 3 — leftovers.
  for (const e of [...unmatchedExisting.values()].sort((a, b) => a.id - b.id)) {
    outcomes.push({ outcome: "supersede", entryId: e.id, entryType: e.entryType });
  }
  drafts.forEach((d, i) => {
    if (!draftMatched.has(i)) {
      outcomes.push({ outcome: "create", draftIndex: i, entryType: d.entryType });
    }
  });
  return outcomes;
}

function summarizeOutcomes(outcomes: RunOutcome[]): RunPreview {
  const addByType: Record<string, number> = {};
  let toAdd = 0;
  let unchanged = 0;
  let toSupersede = 0;
  let merged = 0;
  let preserved = 0;
  for (const o of outcomes) {
    switch (o.outcome) {
      case "create":
        toAdd++;
        addByType[o.entryType] = (addByType[o.entryType] ?? 0) + 1;
        break;
      case "unchanged":
        unchanged++;
        break;
      case "supersede":
        toSupersede++;
        break;
      case "merge":
        merged++;
        break;
      case "preserve":
        preserved++;
        break;
    }
  }
  // Pass-2 drafts also create their replacement entry.
  const replacementDrafts = new Set(
    outcomes
      .filter((o) => (o.outcome === "supersede" || o.outcome === "merge") && o.draftIndex != null)
      .map((o) => o.draftIndex as number)
  );
  for (const i of replacementDrafts) {
    const entryType = outcomes.find(
      (o) => o.draftIndex === i && (o.outcome === "supersede" || o.outcome === "merge")
    )?.entryType;
    toAdd++;
    if (entryType) addByType[entryType] = (addByType[entryType] ?? 0) + 1;
  }
  return {
    toAdd,
    unchanged,
    toSupersede: toSupersede + merged,
    merged,
    preservedDispositioned: preserved,
    addByType,
    outcomes,
  };
}

async function loadReconcileInputs(
  db: PrismaTx | typeof prisma,
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis,
  writeResult: WriteMeetingAnalysisResult
): Promise<{ existing: ExistingEntry[]; drafts: AnchoredDraft[] }> {
  const [existing, segments] = await Promise.all([
    db.meetingRegisterEntry.findMany({
      where: { meetingId, bidId },
      select: {
        id: true,
        entryType: true,
        rawSourceText: true,
        segmentId: true,
        reviewState: true,
        origin: true,
      },
      orderBy: { id: "asc" },
    }),
    db.meetingTranscriptSegment.findMany({
      where: { meetingId, bidId, isActive: true },
      select: {
        id: true,
        startSec: true,
        endSec: true,
        currentSpeakerLabel: true,
        currentText: true,
      },
    }),
  ]);
  const drafts = anchorDraftsToSegments(
    buildRegisterDrafts(analysis, writeResult),
    segments
  );
  return { existing, drafts };
}

async function computePreview(
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis
): Promise<RunPreview> {
  // Lifecycle-row ids are unknown until apply; identity matching uses only
  // entryType + wording + anchors, so empty ids preview the same outcomes.
  const { existing, drafts } = await loadReconcileInputs(prisma, meetingId, bidId, analysis, {
    actionItemIds: [],
    commitmentIds: [],
    designChangeIds: [],
  });
  return summarizeOutcomes(computeReconcile(existing, drafts));
}

/**
 * Apply the reconcile INSIDE the caller's transaction. Never deletes:
 * unchanged entries are kept (bridge links refreshed to the rewritten
 * lifecycle rows), superseded entries are retained with full supersession
 * provenance + an append-only revision row, dispositioned entries are
 * untouched by construction.
 */
async function reconcileRegisterTx(
  tx: PrismaTx,
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis,
  writeResult: WriteMeetingAnalysisResult,
  runId: number,
  appliedBy: string
): Promise<RunPreview> {
  const { existing, drafts } = await loadReconcileInputs(
    tx,
    meetingId,
    bidId,
    analysis,
    writeResult
  );
  const outcomes = computeReconcile(existing, drafts);
  const now = new Date();

  // 1 — creates (including replacement entries for supersede/merge drafts).
  const createdByDraft = new Map<number, number>();
  const creatingDraftIndexes = new Set<number>();
  for (const o of outcomes) {
    if (o.outcome === "create" && o.draftIndex != null) creatingDraftIndexes.add(o.draftIndex);
    if ((o.outcome === "supersede" || o.outcome === "merge") && o.draftIndex != null) {
      creatingDraftIndexes.add(o.draftIndex);
    }
  }
  for (const i of [...creatingDraftIndexes].sort((a, b) => a - b)) {
    const draft = drafts[i];
    const created = await tx.meetingRegisterEntry.create({
      data: {
        meetingId,
        bidId,
        entryType: draft.entryType,
        agendaTopic: draft.agendaTopic,
        rawSourceText: draft.rawSourceText,
        normalizedText: draft.normalizedText,
        speakerLabel: draft.speakerLabel,
        speakerName: draft.speakerName,
        startSec: draft.startSec,
        endSec: draft.endSec,
        sourceCitation: draft.sourceCitation,
        segmentId: draft.segmentId,
        responsibleParty: draft.responsibleParty,
        dueDate: draft.dueDate,
        confidence: draft.confidence,
        origin: draft.origin,
        extractionRunId: runId,
        linkedActionItemId: draft.linkedActionItemId,
        linkedCommitmentId: draft.linkedCommitmentId,
        linkedDesignChangeId: draft.linkedDesignChangeId,
      },
      select: { id: true },
    });
    createdByDraft.set(i, created.id);
  }

  // 2 — supersessions (never deletions). Retain everything; record provenance.
  for (const o of outcomes) {
    if (o.outcome !== "supersede" && o.outcome !== "merge") continue;
    if (o.entryId == null) continue;
    const replacementId = o.draftIndex != null ? createdByDraft.get(o.draftIndex) ?? null : null;
    await tx.meetingRegisterEntry.update({
      where: { id: o.entryId },
      data: {
        reviewState: SUPERSEDED_STATE,
        supersededByRunId: runId,
        supersededByEntryId: replacementId,
        supersededAt: now,
      },
    });
    await tx.meetingRegisterEntryRevision.create({
      data: {
        entryId: o.entryId,
        bidId,
        changeType: "RERUN_SUPERSEDE",
        fromReviewState: "PENDING",
        toReviewState: SUPERSEDED_STATE,
        detailJson: JSON.stringify({
          runId,
          ...(replacementId ? { replacementEntryId: replacementId } : {}),
          ...(o.outcome === "merge" ? { merge: true } : {}),
        }),
        actor: appliedBy,
      },
    });
  }

  // 3 — unchanged entries survive verbatim; refresh bridge links because the
  // analysis writer rewrites the lifecycle rows (their old FKs would go
  // stale via SetNull). Identity, wording, state and the ORIGINATING
  // extractionRunId are preserved.
  for (const o of outcomes) {
    if (o.outcome !== "unchanged" || o.entryId == null || o.draftIndex == null) continue;
    const draft = drafts[o.draftIndex];
    if (
      draft.linkedActionItemId != null ||
      draft.linkedCommitmentId != null ||
      draft.linkedDesignChangeId != null
    ) {
      await tx.meetingRegisterEntry.update({
        where: { id: o.entryId },
        data: {
          linkedActionItemId: draft.linkedActionItemId,
          linkedCommitmentId: draft.linkedCommitmentId,
          linkedDesignChangeId: draft.linkedDesignChangeId,
        },
      });
    }
  }

  // Resolve final entry ids into the outcome list for the audit trail.
  const applied = outcomes.map((o) => {
    if (o.outcome === "create" && o.draftIndex != null) {
      return { ...o, entryId: createdByDraft.get(o.draftIndex) };
    }
    return o;
  });
  return summarizeOutcomes(applied);
}

/**
 * Record an analysis as an extraction run. First-ever run (or none applied
 * yet) applies immediately; later runs land PREVIEWED for human review.
 */
export async function recordAnalysisRun(
  bidId: number,
  meetingId: number,
  analysis: MeetingAnalysis,
  writeResult: WriteMeetingAnalysisResult | null,
  actor: Actor
): Promise<ServiceResult<{ runId: number; status: string; preview: RunPreview }>> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true, analysisVersion: true },
  });
  if (!meeting) return { ok: false, error: "Not found" };

  const priorApplied = await prisma.meetingExtractionRun.count({
    where: { meetingId, status: "APPLIED" },
  });
  const preview = await computePreview(meetingId, bidId, analysis);

  if (priorApplied === 0 && writeResult) {
    // Initial population — analysis was already written by the caller;
    // project the register + write the mandatory audit row in ONE
    // transaction and record an APPLIED run.
    let envelope: AuditEnvelope | null = null;
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.meetingExtractionRun.create({
        data: {
          meetingId,
          bidId,
          analysisVersion: meeting.analysisVersion,
          trigger: "INITIAL",
          status: "APPLIED",
          previewJson: JSON.stringify(preview),
          createdBy: actorLabel(actor),
          appliedBy: actorLabel(actor),
          appliedAt: new Date(),
        },
      });
      const applied = await reconcileRegisterTx(
        tx,
        meetingId,
        bidId,
        analysis,
        writeResult,
        created.id,
        actorLabel(actor) ?? "system"
      );
      envelope = await writeRegisterAuditTx(tx, {
        action: "extraction_run_applied",
        decision: "applied",
        subjectKind: "MeetingExtractionRun",
        subjectId: created.id,
        actor,
        payload: {
          bidId,
          meetingId,
          extractionRunId: created.id,
          trigger: "INITIAL",
          toAdd: applied.toAdd,
          unchanged: applied.unchanged,
          superseded: applied.toSupersede,
          preservedDispositioned: applied.preservedDispositioned,
        },
      });
      return created;
    });
    emitRegisterAuditPostCommit(envelope);
    return { ok: true, value: { runId: run.id, status: "APPLIED", preview } };
  }

  let envelope: AuditEnvelope | null = null;
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.meetingExtractionRun.create({
      data: {
        meetingId,
        bidId,
        analysisVersion: meeting.analysisVersion,
        trigger: "RERUN",
        status: "PREVIEWED",
        analysisJson: JSON.stringify(analysis),
        previewJson: JSON.stringify(preview),
        createdBy: actorLabel(actor),
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "extraction_run_previewed",
      decision: "previewed",
      subjectKind: "MeetingExtractionRun",
      subjectId: created.id,
      actor,
      payload: {
        bidId,
        meetingId,
        extractionRunId: created.id,
        trigger: "RERUN",
        toAdd: preview.toAdd,
        unchanged: preview.unchanged,
        toSupersede: preview.toSupersede,
        preservedDispositioned: preview.preservedDispositioned,
      },
    });
    return created;
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { runId: run.id, status: "PREVIEWED", preview } };
}

export async function getRun(bidId: number, meetingId: number, runId: number) {
  return prisma.meetingExtractionRun.findFirst({
    where: { id: runId, meetingId, bidId },
  });
}

export async function listRuns(bidId: number, meetingId: number) {
  return prisma.meetingExtractionRun.findMany({
    where: { meetingId, bidId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      analysisVersion: true,
      trigger: true,
      status: true,
      previewJson: true,
      createdBy: true,
      createdAt: true,
      appliedBy: true,
      appliedAt: true,
    },
  });
}

/**
 * Human APPLY of a PREVIEWED run — one transaction: lifecycle write +
 * non-destructive register reconcile + run flip + mandatory audit row.
 * Deterministic and idempotent: an identical analysis applied again yields
 * only UNCHANGED outcomes; re-applying an APPLIED run is rejected.
 */
export async function applyRun(
  bidId: number,
  meetingId: number,
  runId: number,
  actor: Actor
): Promise<ServiceResult<{ runId: number; preview: RunPreview }>> {
  const appliedBy = actorLabel(actor);
  if (!appliedBy) return { ok: false, error: "A session actor is required to apply" };
  const run = await getRun(bidId, meetingId, runId);
  if (!run) return { ok: false, error: "Not found" };
  if (run.status !== "PREVIEWED") {
    return { ok: false, error: `Cannot apply a ${run.status} run` };
  }
  let analysis: MeetingAnalysis;
  try {
    analysis = JSON.parse(run.analysisJson) as MeetingAnalysis;
    if (!analysis || !Array.isArray(analysis.section5)) throw new Error("bad shape");
  } catch {
    return { ok: false, error: "Stored analysis is unreadable; discard this run" };
  }

  let envelope: AuditEnvelope | null = null;
  const applied = await prisma.$transaction(async (tx) => {
    // Atomically CLAIM the PREVIEWED run inside the transaction before any
    // writer work. The status read above happened outside the transaction, so
    // two concurrent applies could both observe PREVIEWED; only the request
    // whose conditional update flips exactly one row proceeds, the loser
    // throws and rolls back. Keeps rerun apply idempotent under concurrency.
    const claim = await tx.meetingExtractionRun.updateMany({
      where: { id: run.id, status: "PREVIEWED" },
      data: { status: "APPLIED", appliedBy, appliedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new Error("Run is no longer PREVIEWED — concurrent apply lost the race");
    }
    const writeResult = await writeMeetingAnalysisTx(tx, meetingId, bidId, analysis);
    const result = await reconcileRegisterTx(
      tx,
      meetingId,
      bidId,
      analysis,
      writeResult,
      run.id,
      appliedBy
    );
    await tx.meetingExtractionRun.update({
      where: { id: run.id },
      data: {
        analysisJson: "{}", // clear the bulky payload once applied
        previewJson: JSON.stringify(result), // final outcomes incl. created ids
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "extraction_run_applied",
      decision: "applied",
      subjectKind: "MeetingExtractionRun",
      subjectId: run.id,
      actor,
      payload: {
        bidId,
        meetingId,
        extractionRunId: run.id,
        trigger: run.trigger,
        toAdd: result.toAdd,
        unchanged: result.unchanged,
        superseded: result.toSupersede,
        preservedDispositioned: result.preservedDispositioned,
      },
    });
    return result;
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { runId: run.id, preview: applied } };
}

export async function discardRun(
  bidId: number,
  meetingId: number,
  runId: number,
  actor: Actor
): Promise<ServiceResult<{ runId: number }>> {
  const discardedBy = actorLabel(actor);
  if (!discardedBy) return { ok: false, error: "A session actor is required to discard" };
  const run = await getRun(bidId, meetingId, runId);
  if (!run) return { ok: false, error: "Not found" };
  if (run.status !== "PREVIEWED") {
    return { ok: false, error: `Cannot discard a ${run.status} run` };
  }
  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.meetingExtractionRun.update({
      where: { id: run.id },
      data: { status: "DISCARDED", analysisJson: "{}" },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "extraction_run_discarded",
      decision: "discarded",
      subjectKind: "MeetingExtractionRun",
      subjectId: run.id,
      actor,
      payload: { bidId, meetingId, extractionRunId: run.id },
    });
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { runId: run.id } };
}
