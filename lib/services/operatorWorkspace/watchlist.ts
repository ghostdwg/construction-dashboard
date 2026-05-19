// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/watchlist.ts
//  Phase MI-10 — Watchlist CRUD + item management.
//
//  Operator-curated lists of subjects (developers, parcels, corridors,
//  jurisdictions, brokers, franchises, utilities, project types, mixed).
//  Soft-detach via timestamp; supersede via re-attach without losing
//  history.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitWorkspaceAudit } from "./audit";
import {
  type WatchlistSubjectKind,
  type WatchlistVisibility,
  type WatchlistAttachReason,
  type WatchlistActorContext,
} from "./types";

// ── createWatchlist ──────────────────────────────────────────────────────────

export interface CreateWatchlistInput {
  name: string;
  description?: string;
  subjectKind?: WatchlistSubjectKind;
  visibility?: WatchlistVisibility;
  ruleJson?: string;
  tagsCsv?: string;
  actor: WatchlistActorContext;
}

export async function createWatchlist(input: CreateWatchlistInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const row = await prisma.watchlist.create({
    data: {
      ownerUserId: input.actor.userId,
      ownerEmail: input.actor.email,
      name: input.name,
      description: input.description ?? null,
      subjectKind: input.subjectKind ?? "MIXED",
      visibility: input.visibility ?? "PRIVATE",
      ruleJson: input.ruleJson ?? null,
      tagsCsv: input.tagsCsv ?? null,
    },
  });
  emitWorkspaceAudit({
    action: "create_watchlist",
    watchlistId: row.id,
    decision: "created",
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    factors: { name: input.name, subjectKind: input.subjectKind ?? "MIXED" },
  });
  return { ok: true, id: row.id };
}

// ── updateWatchlist ──────────────────────────────────────────────────────────

export interface UpdateWatchlistInput {
  id: string;
  name?: string;
  description?: string | null;
  subjectKind?: WatchlistSubjectKind;
  visibility?: WatchlistVisibility;
  ruleJson?: string | null;
  tagsCsv?: string | null;
  archived?: boolean;
  actor: WatchlistActorContext;
}

export async function updateWatchlist(input: UpdateWatchlistInput): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.watchlist.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, error: "watchlist_not_found" };

  await prisma.watchlist.update({
    where: { id: input.id },
    data: {
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      subjectKind: input.subjectKind ?? existing.subjectKind,
      visibility: input.visibility ?? existing.visibility,
      ruleJson: input.ruleJson === undefined ? existing.ruleJson : input.ruleJson,
      tagsCsv: input.tagsCsv === undefined ? existing.tagsCsv : input.tagsCsv,
      archivedAt: input.archived === undefined
        ? existing.archivedAt
        : input.archived
        ? new Date()
        : null,
    },
  });
  emitWorkspaceAudit({
    action: "update_watchlist",
    watchlistId: input.id,
    decision: "updated",
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
  });
  return { ok: true };
}

// ── addWatchlistItem ─────────────────────────────────────────────────────────

export interface AddWatchlistItemInput {
  watchlistId: string;
  subjectKind: string;
  subjectId: string;
  projectId?: string | null;
  parcelId?: string | null;
  entityId?: string | null;
  displayLabel?: string;
  displayContext?: string;
  attachReason?: WatchlistAttachReason;
  notes?: string;
  priority?: number;
  actor: WatchlistActorContext;
}

export async function addWatchlistItem(input: AddWatchlistItemInput): Promise<{ ok: boolean; id?: string; alreadyAttached?: boolean; error?: string }> {
  const watchlist = await prisma.watchlist.findUnique({ where: { id: input.watchlistId } });
  if (!watchlist) return { ok: false, error: "watchlist_not_found" };

  // Re-attach if item exists (clear detachedAt).
  const existing = await prisma.watchlistItem.findUnique({
    where: {
      watchlistId_subjectKind_subjectId: {
        watchlistId: input.watchlistId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
      },
    },
  });
  if (existing) {
    await prisma.watchlistItem.update({
      where: { id: existing.id },
      data: {
        detachedAt: null,
        detachedReason: null,
        detachedBy: null,
        displayLabel: input.displayLabel ?? existing.displayLabel,
        displayContext: input.displayContext ?? existing.displayContext,
        priority: input.priority ?? existing.priority,
        notes: input.notes ?? existing.notes,
      },
    });
    emitWorkspaceAudit({
      action: "add_watchlist_item",
      watchlistId: input.watchlistId,
      decision: "re_attached",
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      actorUserId: input.actor.userId,
      actorEmail: input.actor.email,
    });
    return { ok: true, id: existing.id, alreadyAttached: true };
  }

  const row = await prisma.watchlistItem.create({
    data: {
      watchlistId: input.watchlistId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      projectId: input.projectId ?? null,
      parcelId: input.parcelId ?? null,
      entityId: input.entityId ?? null,
      displayLabel: input.displayLabel ?? null,
      displayContext: input.displayContext ?? null,
      attachReason: input.attachReason ?? "MANUAL",
      notes: input.notes ?? null,
      priority: input.priority ?? 3,
    },
  });
  emitWorkspaceAudit({
    action: "add_watchlist_item",
    watchlistId: input.watchlistId,
    decision: "attached",
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
  });
  return { ok: true, id: row.id };
}

// ── removeWatchlistItem ──────────────────────────────────────────────────────

export interface RemoveWatchlistItemInput {
  watchlistItemId: string;
  reason?: string;
  actor: WatchlistActorContext;
}

export async function removeWatchlistItem(input: RemoveWatchlistItemInput): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.watchlistItem.findUnique({ where: { id: input.watchlistItemId } });
  if (!item) return { ok: false, error: "watchlist_item_not_found" };

  await prisma.watchlistItem.update({
    where: { id: input.watchlistItemId },
    data: {
      detachedAt: new Date(),
      detachedReason: input.reason ?? null,
      detachedBy: input.actor.email,
    },
  });
  emitWorkspaceAudit({
    action: "remove_watchlist_item",
    watchlistId: item.watchlistId,
    decision: "soft_detached",
    subjectKind: item.subjectKind,
    subjectId: item.subjectId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
  });
  return { ok: true };
}

// ── listWatchlists ───────────────────────────────────────────────────────────

export interface ListWatchlistsOptions {
  ownerEmail?: string | null;
  visibility?: WatchlistVisibility;
  includeArchived?: boolean;
  limit?: number;
}

export async function listWatchlists(opts: ListWatchlistsOptions = {}) {
  const limit = opts.limit ?? 200;
  const where: Record<string, unknown> = {};
  if (opts.ownerEmail) where.ownerEmail = opts.ownerEmail;
  if (opts.visibility) where.visibility = opts.visibility;
  if (!opts.includeArchived) where.archivedAt = null;
  return prisma.watchlist.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export async function getWatchlist(id: string) {
  return prisma.watchlist.findUnique({
    where: { id },
    include: {
      items: {
        where: { detachedAt: null },
        orderBy: [{ priority: "asc" }, { addedAt: "desc" }],
      },
    },
  });
}
