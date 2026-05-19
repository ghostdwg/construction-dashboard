// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectGovernance/index.ts
//  Phase MI-6 PR3 — Operator governance actions on Project aggregates.
//
//  Service-layer functions called from API routes. UI never touches Prisma
//  directly. Every action emits a [project-governance] stdout audit line
//  AND records a ProjectTimelineEvent so the project's history view stays
//  the source of truth for "what happened on this aggregate".
//
//  Reversibility rules:
//   - reject / stall / verify    — flip reviewStatus or lifecycleState only;
//                                  trivially reversed by an opposite action
//   - mergeProjects               — preserves source as REJECTED + MERGED with
//                                  mergedIntoProjectId forwarding pointer.
//                                  All children move; no row is deleted.
//   - detachProjectSignal         — soft-detach via ProjectSignal.detachedAt
//                                  + detachedReason + detachedBy. Row preserved.
//   - reattachProjectSignal       — equivalent to detach + attach. Old row
//                                  preserved (detached); new ProjectSignal
//                                  created on the target project.
//   - addProjectNote              — pure append to ProjectTimelineEvent.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  attachSignalToProject,
  recordTimelineEvent,
  transitionState,
  updateProjectProbability,
  type LifecycleState,
  type SignalKind,
  type SignalInput,
} from "@/lib/services/projectAggregation";
import type {
  GovernanceActorContext,
  GovernanceResult,
  ProjectMergePlan,
  TransitionStateRequest,
} from "./types";

const AUDIT_PREFIX = "[project-governance]";

function audit(action: string, payload: Record<string, unknown>): void {
  console.info(
    `${AUDIT_PREFIX} ${JSON.stringify({ action, timestamp: new Date().toISOString(), ...payload })}`
  );
}

function appendNote(existing: string | null, addition: string): string {
  if (!existing) return addition;
  return `${existing}\n${addition}`;
}

// ── verifyProject ─────────────────────────────────────────────────────────────

export async function verifyProject(
  projectId: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ projectId: string }>> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.reviewStatus === "REJECTED") {
    return { ok: false, error: "Cannot verify a REJECTED project. Un-reject first." };
  }
  if (project.reviewStatus === "MERGED") {
    return { ok: false, error: "Cannot verify a MERGED project. Operate on the target instead." };
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id: projectId },
      data: { reviewStatus: "VERIFIED", confidence: "VERIFIED" },
    }),
    prisma.projectTimelineEvent.create({
      data: {
        projectId,
        eventType: "REVIEW_ACTION",
        occurredAt: new Date(),
        summary: `Verified by operator (was reviewStatus=${project.reviewStatus})`,
        payloadJson: JSON.stringify({
          action: "verify",
          previousReviewStatus: project.reviewStatus,
          previousConfidence: project.confidence,
        }),
        actorUserId: actor.userId,
        actorEmail: actor.email,
      },
    }),
  ]);

  audit("verify_project", { projectId, actor });
  return { ok: true, data: { projectId } };
}

// ── rejectProject ─────────────────────────────────────────────────────────────

export async function rejectProject(
  projectId: string,
  actor: GovernanceActorContext,
  reason?: string
): Promise<GovernanceResult<{ projectId: string }>> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, error: "Project not found" };

  await prisma.$transaction([
    prisma.project.update({
      where: { id: projectId },
      data: {
        reviewStatus: "REJECTED",
        notes: reason ? appendNote(project.notes, `REJECTED: ${reason}`) : project.notes,
      },
    }),
    prisma.projectTimelineEvent.create({
      data: {
        projectId,
        eventType: "REVIEW_ACTION",
        occurredAt: new Date(),
        summary: `Rejected by operator${reason ? ": " + reason : ""}`,
        payloadJson: JSON.stringify({
          action: "reject",
          reason: reason ?? null,
          previousReviewStatus: project.reviewStatus,
        }),
        actorUserId: actor.userId,
        actorEmail: actor.email,
      },
    }),
  ]);

  audit("reject_project", { projectId, reason: reason ?? null, actor });
  return { ok: true, data: { projectId } };
}

// ── markProjectStalled ────────────────────────────────────────────────────────

export async function markProjectStalled(
  projectId: string,
  actor: GovernanceActorContext,
  reason?: string
): Promise<GovernanceResult<{ projectId: string }>> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.lifecycleState === "STALLED") {
    return { ok: false, error: "Project is already STALLED" };
  }

  const result = await transitionState({
    projectId,
    toState: "STALLED",
    reason: reason ?? "operator-marked stalled",
    actor: { userId: actor.userId, email: actor.email },
  });

  if (!result.transitioned) return { ok: false, error: result.reason };
  audit("mark_stalled", { projectId, fromState: result.fromState, reason: reason ?? null, actor });
  return { ok: true, data: { projectId } };
}

// ── transitionProjectState ────────────────────────────────────────────────────

export async function transitionProjectState(
  request: TransitionStateRequest,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ projectId: string; fromState: LifecycleState }>> {
  const result = await transitionState({
    projectId: request.projectId,
    toState: request.toState,
    reason: request.reason,
    override: request.override,
    actor: { userId: actor.userId, email: actor.email },
  });
  if (!result.transitioned) return { ok: false, error: result.reason };
  audit("transition_state", {
    projectId: request.projectId,
    fromState: result.fromState,
    toState: request.toState,
    override: request.override ?? false,
    reason: request.reason,
    actor,
  });
  return { ok: true, data: { projectId: request.projectId, fromState: result.fromState } };
}

// ── planProjectMerge ──────────────────────────────────────────────────────────

export async function planProjectMerge(
  sourceProjectId: string,
  targetProjectId: string
): Promise<GovernanceResult<ProjectMergePlan>> {
  if (sourceProjectId === targetProjectId) {
    return { ok: false, error: "Source and target are the same project" };
  }
  const [source, target] = await Promise.all([
    prisma.project.findUnique({ where: { id: sourceProjectId } }),
    prisma.project.findUnique({ where: { id: targetProjectId } }),
  ]);
  if (!source) return { ok: false, error: "Source project not found" };
  if (!target) return { ok: false, error: "Target project not found" };
  if (target.reviewStatus === "REJECTED" || target.reviewStatus === "MERGED") {
    return { ok: false, error: `Target project is ${target.reviewStatus}; cannot merge into it.` };
  }

  const [signalsToMove, entitiesToMove, parcelsToMove] = await Promise.all([
    prisma.projectSignal.count({ where: { projectId: sourceProjectId, detachedAt: null } }),
    prisma.projectEntity.count({ where: { projectId: sourceProjectId, removed: false } }),
    prisma.projectParcel.count({ where: { projectId: sourceProjectId } }),
  ]);

  return {
    ok: true,
    data: { sourceProjectId, targetProjectId, signalsToMove, entitiesToMove, parcelsToMove },
  };
}

// ── mergeProjects ─────────────────────────────────────────────────────────────

export async function mergeProjects(
  sourceProjectId: string,
  targetProjectId: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<ProjectMergePlan>> {
  const plan = await planProjectMerge(sourceProjectId, targetProjectId);
  if (!plan.ok || !plan.data) return plan;

  const [source, target] = await Promise.all([
    prisma.project.findUnique({ where: { id: sourceProjectId } }),
    prisma.project.findUnique({ where: { id: targetProjectId } }),
  ]);
  if (!source || !target) return { ok: false, error: "Project not found (race)" };

  const mergeTs = new Date();
  await prisma.$transaction(async (tx) => {
    // 1. Repoint signals (non-detached)
    await tx.projectSignal.updateMany({
      where: { projectId: sourceProjectId, detachedAt: null },
      data: { projectId: targetProjectId },
    });

    // 2. Move entities — handle unique constraint (projectId, entityId, role)
    const srcEntities = await tx.projectEntity.findMany({
      where: { projectId: sourceProjectId, removed: false },
    });
    for (const e of srcEntities) {
      const collision = await tx.projectEntity.findFirst({
        where: { projectId: targetProjectId, entityId: e.entityId, role: e.role },
      });
      if (collision) {
        await tx.projectEntity.update({
          where: { id: collision.id },
          data: {
            firstSeenAt: collision.firstSeenAt < e.firstSeenAt ? collision.firstSeenAt : e.firstSeenAt,
            lastSeenAt: collision.lastSeenAt > e.lastSeenAt ? collision.lastSeenAt : e.lastSeenAt,
            removed: false,
          },
        });
        await tx.projectEntity.update({
          where: { id: e.id },
          data: { removed: true, removedReason: "merged_into_target", removedBy: actor.userId ?? "system" },
        });
      } else {
        await tx.projectEntity.update({
          where: { id: e.id },
          data: { projectId: targetProjectId },
        });
      }
    }

    // 3. Move parcels — handle unique constraint (projectId, parcelId, parcelSource)
    const srcParcels = await tx.projectParcel.findMany({
      where: { projectId: sourceProjectId },
    });
    for (const p of srcParcels) {
      const collision = await tx.projectParcel.findFirst({
        where: { projectId: targetProjectId, parcelId: p.parcelId, parcelSource: p.parcelSource },
      });
      if (collision) {
        await tx.projectParcel.delete({ where: { id: p.id } });
      } else {
        await tx.projectParcel.update({
          where: { id: p.id },
          data: { projectId: targetProjectId },
        });
      }
    }

    // 4. Mark source as MERGED with forwarding pointer + reviewStatus
    await tx.project.update({
      where: { id: sourceProjectId },
      data: {
        reviewStatus: "MERGED",
        mergedIntoProjectId: targetProjectId,
        notes: appendNote(
          source.notes,
          `Merged into ${target.workingTitle} (${targetProjectId}) at ${mergeTs.toISOString()}`
        ),
      },
    });

    // 5. Update target temporal anchors so firstSignalAt = min, lastSignalAt = max
    const earliestFirst =
      source.firstSignalAt && target.firstSignalAt
        ? source.firstSignalAt < target.firstSignalAt
          ? source.firstSignalAt
          : target.firstSignalAt
        : source.firstSignalAt ?? target.firstSignalAt ?? null;
    const latestLast =
      source.lastSignalAt && target.lastSignalAt
        ? source.lastSignalAt > target.lastSignalAt
          ? source.lastSignalAt
          : target.lastSignalAt
        : source.lastSignalAt ?? target.lastSignalAt ?? null;
    await tx.project.update({
      where: { id: targetProjectId },
      data: {
        firstSignalAt: earliestFirst,
        lastSignalAt: latestLast,
        notes: appendNote(
          target.notes,
          `Absorbed ${source.workingTitle} (${sourceProjectId}) at ${mergeTs.toISOString()}`
        ),
      },
    });

    // 6. Timeline events on BOTH sides
    const planData = plan.data!;
    await tx.projectTimelineEvent.create({
      data: {
        projectId: sourceProjectId,
        eventType: "MERGE_INTO",
        occurredAt: mergeTs,
        summary: `Merged into ${target.workingTitle} (${targetProjectId})`,
        payloadJson: JSON.stringify({
          targetProjectId,
          signalsToMove: planData.signalsToMove,
          entitiesToMove: planData.entitiesToMove,
          parcelsToMove: planData.parcelsToMove,
        }),
        actorUserId: actor.userId,
        actorEmail: actor.email,
      },
    });
    await tx.projectTimelineEvent.create({
      data: {
        projectId: targetProjectId,
        eventType: "MERGE_RECEIVED",
        occurredAt: mergeTs,
        summary: `Absorbed ${source.workingTitle} (${sourceProjectId})`,
        payloadJson: JSON.stringify({
          sourceProjectId,
          signalsMoved: planData.signalsToMove,
          entitiesMoved: planData.entitiesToMove,
          parcelsMoved: planData.parcelsToMove,
        }),
        actorUserId: actor.userId,
        actorEmail: actor.email,
      },
    });
  });

  // 7. Recompute target probability outside the transaction so the snapshot
  // reflects the full post-merge state.
  try {
    await updateProjectProbability({ projectId: targetProjectId, reason: "merge_received" });
  } catch (err) {
    console.warn("[project-governance] post-merge probability update failed:", err);
  }

  audit("merge_projects", {
    sourceProjectId,
    targetProjectId,
    signalsMoved: plan.data.signalsToMove,
    entitiesMoved: plan.data.entitiesToMove,
    parcelsMoved: plan.data.parcelsToMove,
    actor,
  });
  return plan;
}

// ── detachProjectSignal ───────────────────────────────────────────────────────

export async function detachProjectSignal(
  projectId: string,
  projectSignalId: string,
  actor: GovernanceActorContext,
  reason?: string
): Promise<GovernanceResult<{ projectSignalId: string }>> {
  const signal = await prisma.projectSignal.findUnique({ where: { id: projectSignalId } });
  if (!signal) return { ok: false, error: "ProjectSignal not found" };
  if (signal.projectId !== projectId) {
    return { ok: false, error: "Signal does not belong to this project" };
  }
  if (signal.detachedAt) {
    return { ok: false, error: "Signal is already detached" };
  }

  await prisma.$transaction([
    prisma.projectSignal.update({
      where: { id: projectSignalId },
      data: {
        detachedAt: new Date(),
        detachedReason: reason ?? "operator_detach",
        detachedBy: actor.userId ?? "operator",
      },
    }),
    prisma.projectTimelineEvent.create({
      data: {
        projectId,
        eventType: "SIGNAL_DETACHED",
        occurredAt: new Date(),
        summary: `Signal detached${reason ? ": " + reason : ""}`,
        payloadJson: JSON.stringify({
          projectSignalId,
          signalKind: signal.signalKind,
          attachScore: signal.attachScore,
          reason: reason ?? null,
        }),
        sourceRefKind: signal.signalKind,
        sourceRefId: projectSignalId,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      },
    }),
  ]);

  audit("detach_signal", { projectId, projectSignalId, reason: reason ?? null, actor });
  return { ok: true, data: { projectSignalId } };
}

// ── reattachProjectSignal ─────────────────────────────────────────────────────

export async function reattachProjectSignal(
  projectSignalId: string,
  toProjectId: string,
  actor: GovernanceActorContext,
  reason?: string
): Promise<GovernanceResult<{ newProjectSignalId: string }>> {
  const signal = await prisma.projectSignal.findUnique({ where: { id: projectSignalId } });
  if (!signal) return { ok: false, error: "ProjectSignal not found" };
  if (signal.projectId === toProjectId) {
    return { ok: false, error: "Signal already belongs to the target project" };
  }
  const target = await prisma.project.findUnique({ where: { id: toProjectId } });
  if (!target) return { ok: false, error: "Target project not found" };
  if (target.reviewStatus === "REJECTED" || target.reviewStatus === "MERGED") {
    return {
      ok: false,
      error: `Target project is ${target.reviewStatus}; cannot reattach to it.`,
    };
  }

  // Reconstruct a minimal SignalInput from the persisted ProjectSignal fields.
  // The original source row's full state isn't needed for reattachment —
  // attachReason/score carry over from the detach record.
  const sourceId =
    signal.sourceMarketSignalId ??
    signal.sourceRelationshipEdgeId ??
    signal.sourceMarketLeadId ??
    signal.sourceMarketSourceDocId ??
    signal.sourceExternalRef ??
    null;
  const signalInput: SignalInput = {
    kind: signal.signalKind as SignalKind,
    sourceId,
    title: null,
    occurredAt: signal.attachedAt,
    jurisdiction: null,
    parcelIds: [],
    entityIds: [],
    address: null,
    tags: [],
  };

  // Detach from the original project + attach to the new project. The
  // attachSignalToProject path writes a new ProjectSignal + a
  // SIGNAL_ATTACHED timeline event; detach is recorded here.
  const fromProjectId = signal.projectId;
  await prisma.$transaction([
    prisma.projectSignal.update({
      where: { id: projectSignalId },
      data: {
        detachedAt: new Date(),
        detachedReason: reason ?? "operator_reattach",
        detachedBy: actor.userId ?? "operator",
      },
    }),
    prisma.projectTimelineEvent.create({
      data: {
        projectId: fromProjectId,
        eventType: "SIGNAL_DETACHED",
        occurredAt: new Date(),
        summary: `Signal reattached to ${toProjectId}${reason ? ": " + reason : ""}`,
        payloadJson: JSON.stringify({
          projectSignalId,
          reattachedTo: toProjectId,
          reason: reason ?? null,
        }),
        sourceRefKind: signal.signalKind,
        sourceRefId: projectSignalId,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      },
    }),
  ]);

  const reattached = await attachSignalToProject({
    projectId: toProjectId,
    signal: signalInput,
    attachReason: `operator_reattach:${reason ?? "no_reason_given"}`,
    attachScore: signal.attachScore,
    actor: { userId: actor.userId, email: actor.email },
  });

  try {
    await updateProjectProbability({ projectId: toProjectId, reason: "reattach_in" });
    await updateProjectProbability({ projectId: fromProjectId, reason: "reattach_out" });
  } catch (err) {
    console.warn("[project-governance] post-reattach probability update failed:", err);
  }

  audit("reattach_signal", {
    projectSignalId,
    fromProjectId,
    toProjectId,
    newProjectSignalId: reattached.projectSignalId,
    reason: reason ?? null,
    actor,
  });
  return { ok: true, data: { newProjectSignalId: reattached.projectSignalId } };
}

// ── addProjectNote ────────────────────────────────────────────────────────────

export async function addProjectNote(
  projectId: string,
  note: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ projectId: string }>> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, error: "Note is empty" };
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, error: "Project not found" };

  await recordTimelineEvent({
    projectId,
    eventType: "MANUAL_NOTE",
    occurredAt: new Date(),
    summary: trimmed.slice(0, 200),
    payload: { fullNote: trimmed },
    actorUserId: actor.userId,
    actorEmail: actor.email,
  });

  audit("add_note", { projectId, length: trimmed.length, actor });
  return { ok: true, data: { projectId } };
}

export type { GovernanceActorContext, GovernanceResult, ProjectMergePlan, TransitionStateRequest } from "./types";
