// lib/services/meetingRegister/extractionRuns.ts
//
// Module R2-B1 — extraction runs: the preview/apply lifecycle for analysis
// → register projection (R2 rules 7–8).
//
// The FIRST run for a meeting applies immediately (initial population —
// there is nothing to preview against). Every later run lands PREVIEWED
// holding the parsed analysis; a human applies or discards it. Apply
// replaces PENDING machine-origin entries only. Dispositioned entries are
// NEVER touched — their wording, citation and disposition survive every
// rerun (freeze discipline, mirroring the OPS5/OPS7 PROPOSED-replacement
// rule). Nothing here calls a provider; the analysis JSON arrives from the
// analyze route.

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import {
  writeMeetingAnalysisTx,
  type MeetingAnalysis,
  type WriteMeetingAnalysisResult,
} from "@/lib/meeting-analysis";
import { buildRegisterDrafts, anchorDraftsToSegments } from "./registerBuilder";
import { EXTRACTED_ORIGINS, actorLabel, type Actor, type ServiceResult } from "./types";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type RunPreview = {
  toAdd: number;
  toReplacePending: number;
  preservedDispositioned: number;
  addByType: Record<string, number>;
};

async function audit(
  action: string,
  bidId: number,
  runId: number,
  actor: Actor | null,
  decision: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await emitAuditEvent({
      category: "register_action",
      action,
      severity: "NOTICE",
      decision,
      subject: { kind: "MeetingExtractionRun", id: String(runId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[meetingRegister/extractionRuns] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

async function computePreview(
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis
): Promise<RunPreview> {
  // Ids are unknown until apply; the draft SHAPE is what the preview needs.
  const drafts = buildRegisterDrafts(analysis, {
    actionItemIds: [],
    commitmentIds: [],
    designChangeIds: [],
  });
  const existing = await prisma.meetingRegisterEntry.findMany({
    where: { meetingId, bidId },
    select: { reviewState: true, origin: true },
  });
  const machinePending = existing.filter(
    (e) =>
      (EXTRACTED_ORIGINS as readonly string[]).includes(e.origin) &&
      e.reviewState === "PENDING"
  ).length;
  const dispositioned = existing.filter((e) => e.reviewState !== "PENDING").length;
  const addByType: Record<string, number> = {};
  for (const d of drafts) addByType[d.entryType] = (addByType[d.entryType] ?? 0) + 1;
  return {
    toAdd: drafts.length,
    toReplacePending: machinePending,
    preservedDispositioned: dispositioned,
    addByType,
  };
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
    // project the register inside one transaction and record an APPLIED run.
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
      await projectRegisterTx(tx, meetingId, bidId, analysis, writeResult, created.id);
      return created;
    });
    await audit("extraction_run_applied", bidId, run.id, actor, "applied", {
      meetingId,
      trigger: "INITIAL",
      toAdd: preview.toAdd,
    });
    return { ok: true, value: { runId: run.id, status: "APPLIED", preview } };
  }

  const run = await prisma.meetingExtractionRun.create({
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
  await audit("extraction_run_previewed", bidId, run.id, actor, "previewed", {
    meetingId,
    trigger: "RERUN",
    toAdd: preview.toAdd,
    toReplacePending: preview.toReplacePending,
  });
  return { ok: true, value: { runId: run.id, status: "PREVIEWED", preview } };
}

/** Replace PENDING machine-origin entries and insert the new projection. */
async function projectRegisterTx(
  tx: PrismaTx,
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis,
  writeResult: WriteMeetingAnalysisResult,
  runId: number
): Promise<{ added: number; replaced: number }> {
  const pending = await tx.meetingRegisterEntry.findMany({
    where: {
      meetingId,
      bidId,
      reviewState: "PENDING",
      origin: { in: [...EXTRACTED_ORIGINS] },
    },
    select: { id: true },
  });
  // PENDING machine entries are the extractor's ceiling — replacing them on
  // an applied rerun mirrors the OPS5/OPS7 PROPOSED-replacement rule.
  // Dispositioned entries are untouched by construction of the WHERE above.
  if (pending.length > 0) {
    await tx.meetingRegisterEntry.deleteMany({
      where: { id: { in: pending.map((p) => p.id) } },
    });
  }

  const segments = await tx.meetingTranscriptSegment.findMany({
    where: { meetingId, bidId, isActive: true },
    select: {
      id: true,
      startSec: true,
      endSec: true,
      currentSpeakerLabel: true,
      currentText: true,
    },
  });
  const drafts = anchorDraftsToSegments(
    buildRegisterDrafts(analysis, writeResult),
    segments
  );
  for (const draft of drafts) {
    await tx.meetingRegisterEntry.create({
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
    });
  }
  return { added: drafts.length, replaced: pending.length };
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

/** Human APPLY of a PREVIEWED run — atomic: lifecycle write + projection. */
export async function applyRun(
  bidId: number,
  meetingId: number,
  runId: number,
  actor: Actor
): Promise<ServiceResult<{ runId: number; added: number; replaced: number }>> {
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

  const result = await prisma.$transaction(async (tx) => {
    const writeResult = await writeMeetingAnalysisTx(tx, meetingId, bidId, analysis);
    const projected = await projectRegisterTx(
      tx,
      meetingId,
      bidId,
      analysis,
      writeResult,
      run.id
    );
    await tx.meetingExtractionRun.update({
      where: { id: run.id },
      data: {
        status: "APPLIED",
        analysisJson: "{}", // clear the bulky payload once applied
        appliedBy,
        appliedAt: new Date(),
      },
    });
    return projected;
  });

  await audit("extraction_run_applied", bidId, run.id, actor, "applied", {
    meetingId,
    trigger: run.trigger,
    added: result.added,
    replaced: result.replaced,
  });
  return { ok: true, value: { runId: run.id, ...result } };
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
  await prisma.meetingExtractionRun.update({
    where: { id: run.id },
    data: { status: "DISCARDED", analysisJson: "{}" },
  });
  await audit("extraction_run_discarded", bidId, run.id, actor, "discarded", {
    meetingId,
  });
  return { ok: true, value: { runId: run.id } };
}
