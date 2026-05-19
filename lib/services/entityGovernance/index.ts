// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityGovernance/index.ts
//  Phase MI-4 — Operator governance actions on Entity / EntityAlias.
//
//  Service-layer functions called by API routes. Pure-ish: each accepts a
//  GovernanceActorContext for audit attribution, performs a single
//  transaction, and returns a structured result. UI mutations route through
//  these functions; no UI ever touches Prisma directly.
//
//  Every action emits a structured audit line to stdout for grep-ability.
//  Future MI-5+ may persist these to a dedicated audit table.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/services/entityResolver";
import type {
  AliasInput,
  GovernanceActorContext,
  GovernanceResult,
  MergePlan,
} from "./types";

const AUDIT_PREFIX = "[entity-governance]";

function audit(action: string, payload: Record<string, unknown>): void {
  console.info(
    `${AUDIT_PREFIX} ${JSON.stringify({ action, timestamp: new Date().toISOString(), ...payload })}`
  );
}

// ── Verify ───────────────────────────────────────────────────────────────────

export async function verifyEntity(
  entityId: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ entityId: string }>> {
  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) return { ok: false, error: "Entity not found" };
  if (entity.reviewStatus === "REJECTED") {
    return { ok: false, error: "Cannot verify a REJECTED entity. Un-reject first." };
  }

  await prisma.entity.update({
    where: { id: entityId },
    data: { reviewStatus: "VERIFIED", confidence: "VERIFIED" },
  });

  audit("verify_entity", {
    entityId,
    previousReviewStatus: entity.reviewStatus,
    previousConfidence: entity.confidence,
    actorUserId: actor.userId,
    actorEmail: actor.email,
  });

  return { ok: true, data: { entityId } };
}

// ── Reject ───────────────────────────────────────────────────────────────────

export async function rejectEntity(
  entityId: string,
  actor: GovernanceActorContext,
  reason?: string
): Promise<GovernanceResult<{ entityId: string }>> {
  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) return { ok: false, error: "Entity not found" };

  await prisma.entity.update({
    where: { id: entityId },
    data: {
      reviewStatus: "REJECTED",
      notes: reason ? appendNote(entity.notes, `REJECTED: ${reason}`) : entity.notes,
    },
  });

  audit("reject_entity", {
    entityId,
    previousReviewStatus: entity.reviewStatus,
    reason: reason ?? null,
    actorUserId: actor.userId,
    actorEmail: actor.email,
  });

  return { ok: true, data: { entityId } };
}

// ── Un-reject (restore from REJECTED to PENDING_REVIEW) ──────────────────────

export async function unrejectEntity(
  entityId: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ entityId: string }>> {
  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) return { ok: false, error: "Entity not found" };
  if (entity.reviewStatus !== "REJECTED") {
    return { ok: false, error: "Entity is not REJECTED" };
  }

  await prisma.entity.update({
    where: { id: entityId },
    data: { reviewStatus: "PENDING_REVIEW" },
  });

  audit("unreject_entity", { entityId, actorUserId: actor.userId, actorEmail: actor.email });
  return { ok: true, data: { entityId } };
}

// ── Merge ────────────────────────────────────────────────────────────────────

/**
 * Plan-only inspection of what a merge would do. UI shows this to operator
 * before they confirm. No writes.
 */
export async function planMerge(
  sourceEntityId: string,
  targetEntityId: string
): Promise<GovernanceResult<MergePlan>> {
  if (sourceEntityId === targetEntityId) {
    return { ok: false, error: "Source and target are the same entity" };
  }
  const [source, target] = await Promise.all([
    prisma.entity.findUnique({ where: { id: sourceEntityId } }),
    prisma.entity.findUnique({ where: { id: targetEntityId } }),
  ]);
  if (!source) return { ok: false, error: "Source entity not found" };
  if (!target) return { ok: false, error: "Target entity not found" };
  if (target.reviewStatus === "REJECTED") {
    return { ok: false, error: "Target entity is REJECTED. Cannot merge into it." };
  }

  const aliasesToMove = await prisma.entityAlias.count({ where: { entityId: sourceEntityId } });
  const relationshipsFromCount = await prisma.entityRelationship.count({
    where: { fromEntityId: sourceEntityId },
  });
  const relationshipsToCount = await prisma.entityRelationship.count({
    where: { toEntityId: sourceEntityId },
  });

  return {
    ok: true,
    data: {
      sourceEntityId,
      targetEntityId,
      aliasesToMove,
      relationshipsToRepoint: relationshipsFromCount + relationshipsToCount,
    },
  };
}

/**
 * Merge sourceEntity INTO targetEntity:
 *   1. Add an alias on target with source's canonicalName + normalizedName.
 *   2. Move all of source's aliases to target (skip duplicates by normalizedAlias).
 *   3. Repoint all EntityRelationship rows pointing at source → target.
 *   4. Mark source as REJECTED with notes pointing at target (audit trail).
 *
 * Single transaction. Idempotent if rerun (skipped-duplicate aliases).
 *
 * Does NOT delete source. Operator can manually delete REJECTED entities
 * via a separate DB op if desired; canonical history is preserved.
 */
export async function mergeEntities(
  sourceEntityId: string,
  targetEntityId: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<MergePlan>> {
  const plan = await planMerge(sourceEntityId, targetEntityId);
  if (!plan.ok || !plan.data) return plan;

  const [source, target] = await Promise.all([
    prisma.entity.findUnique({ where: { id: sourceEntityId } }),
    prisma.entity.findUnique({ where: { id: targetEntityId } }),
  ]);
  if (!source || !target) return { ok: false, error: "Entity not found (race)" };

  await prisma.$transaction(async (tx) => {
    // 1. Add source's canonical name as an alias on target (if not already)
    const sourceCanonAlias = await tx.entityAlias.findFirst({
      where: { entityId: targetEntityId, normalizedAlias: source.normalizedName },
    });
    if (!sourceCanonAlias) {
      await tx.entityAlias.create({
        data: {
          entityId: targetEntityId,
          alias: source.canonicalName,
          normalizedAlias: source.normalizedName,
          confidence: "VERIFIED",
          source: "merge",
        },
      });
    }

    // 2. Move aliases — collision-safe
    const sourceAliases = await tx.entityAlias.findMany({ where: { entityId: sourceEntityId } });
    for (const a of sourceAliases) {
      const collision = await tx.entityAlias.findFirst({
        where: { entityId: targetEntityId, normalizedAlias: a.normalizedAlias },
      });
      if (collision) {
        await tx.entityAlias.delete({ where: { id: a.id } });
      } else {
        await tx.entityAlias.update({
          where: { id: a.id },
          data: { entityId: targetEntityId, source: a.source ?? "merge" },
        });
      }
    }

    // 3. Repoint EntityRelationship rows
    await tx.entityRelationship.updateMany({
      where: { fromEntityId: sourceEntityId },
      data: { fromEntityId: targetEntityId },
    });
    await tx.entityRelationship.updateMany({
      where: { toEntityId: sourceEntityId },
      data: { toEntityId: targetEntityId },
    });

    // Also repoint RelationshipEdge legacy FKs so the historical view stays
    // consistent with the merged canonical.
    await tx.relationshipEdge.updateMany({
      where: { fromEntityId: sourceEntityId },
      data: { fromEntityId: targetEntityId },
    });
    await tx.relationshipEdge.updateMany({
      where: { toEntityId: sourceEntityId },
      data: { toEntityId: targetEntityId },
    });

    // 4. REJECT source with a forwarding note
    await tx.entity.update({
      where: { id: sourceEntityId },
      data: {
        reviewStatus: "REJECTED",
        notes: appendNote(
          source.notes,
          `Merged into ${target.canonicalName} (${targetEntityId}) at ${new Date().toISOString()}`
        ),
      },
    });
  });

  audit("merge_entities", {
    sourceEntityId,
    targetEntityId,
    aliasesMoved: plan.data.aliasesToMove,
    relationshipsRepointed: plan.data.relationshipsToRepoint,
    actorUserId: actor.userId,
    actorEmail: actor.email,
  });

  return plan;
}

// ── Aliases ──────────────────────────────────────────────────────────────────

export async function addAlias(
  entityId: string,
  input: AliasInput,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ aliasId: string }>> {
  const alias = input.alias.trim();
  if (!alias) return { ok: false, error: "alias is required" };
  const normalizedAlias = normalizeEntityName(alias);
  if (!normalizedAlias) return { ok: false, error: "alias normalizes to empty form" };

  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) return { ok: false, error: "Entity not found" };

  try {
    const created = await prisma.entityAlias.create({
      data: {
        entityId,
        alias,
        normalizedAlias,
        confidence: input.confidence ?? "MEDIUM",
        source: "manual",
      },
    });
    audit("add_alias", {
      entityId,
      aliasId: created.id,
      alias,
      normalizedAlias,
      actorUserId: actor.userId,
    });
    return { ok: true, data: { aliasId: created.id } };
  } catch (err) {
    // P2002 unique violation — alias already exists on this entity
    return { ok: false, error: "Alias already exists on this entity" };
  }
}

export async function removeAlias(
  entityId: string,
  aliasId: string,
  actor: GovernanceActorContext
): Promise<GovernanceResult<{ aliasId: string }>> {
  const alias = await prisma.entityAlias.findUnique({ where: { id: aliasId } });
  if (!alias) return { ok: false, error: "Alias not found" };
  if (alias.entityId !== entityId) return { ok: false, error: "Alias does not belong to this entity" };

  await prisma.entityAlias.delete({ where: { id: aliasId } });
  audit("remove_alias", { entityId, aliasId, alias: alias.alias, actorUserId: actor.userId });
  return { ok: true, data: { aliasId } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendNote(existing: string | null, addition: string): string {
  if (!existing) return addition;
  return `${existing}\n${addition}`;
}

export { type GovernanceActorContext, type GovernanceResult, type MergePlan } from "./types";
