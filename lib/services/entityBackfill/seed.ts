// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/seed.ts
//  Phase MI-3 — Watchlist seed parsing + materialization.
//
//  Reads docs/sources/ENTITIES_WATCHLIST.md (treated as immutable spec per
//  the operator-confirmed MI-1 decision) and produces:
//
//   1. EntityWatchlistSeed rows — one per ### heading, capturing the
//      raw canonical name, category, notes, counterparties
//   2. Entity rows — created at VERIFIED+VERIFIED for any seed whose
//      normalizedName is not yet present in the Entity table
//
//  Idempotent: rerunning skips already-materialized seeds. Operator can edit
//  the markdown and rerun; new entries are picked up, existing ones are
//  not duplicated.
//
//  NOT in scope here: EntityAlias creation. Aliases are discovered during
//  the RelationshipEdge backfill (Phase B) — the markdown lists names but
//  not LLC variants. Future watchlist additions of explicit aliases are
//  layered in via the parser output.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeEntityName } from "@/lib/services/entityResolver";
import type { EntityType } from "@/lib/services/entityResolver";
import { prisma } from "@/lib/prisma";
import type { WatchlistSeedEntry, WatchlistSeedProgress } from "./types";

// Resolves relative to process.cwd() — the operator invokes the CLI from
// the project root, which is consistent with how `npm run` resolves
// scripts. Avoids `import.meta.url` so the module works under both ESM
// and CJS runtimes (ts-node, tsx, node --import).
export const WATCHLIST_DEFAULT_PATH = resolve(
  process.cwd(),
  "docs",
  "sources",
  "ENTITIES_WATCHLIST.md"
);

export function readWatchlist(path: string = WATCHLIST_DEFAULT_PATH): string {
  return readFileSync(path, "utf8");
}

// ── Parser ────────────────────────────────────────────────────────────────────

// Maps a markdown role line ("Developer (most active in DSM)" etc.) to one
// of our canonical EntityType values. First-token match against keywords.
function inferEntityType(roleLine: string | null, category: string): EntityType {
  const lowered = (roleLine ?? "").toLowerCase();
  if (lowered.includes("developer")) return "Developer";
  if (lowered.includes("general contractor") || /\bgc\b/.test(lowered)) return "GC";
  if (lowered.includes("architect")) return "Architect";
  if (lowered.includes("engineer")) return "Engineer";
  if (lowered.includes("broker")) return "Broker";
  if (lowered.includes("tenant")) return "Tenant";
  if (lowered.includes("lender")) return "Lender";
  if (lowered.includes("municipality") || lowered.includes("government") || lowered.includes("agency")) {
    return lowered.includes("municipality") ? "Municipality" : "Agency";
  }
  if (lowered.includes("owner")) return "Owner";
  // Category-based fallback
  if (/general contractor/i.test(category)) return "GC";
  if (/architect/i.test(category)) return "Architect";
  if (/engineer/i.test(category)) return "Engineer";
  if (/owner|corporate|developer/i.test(category)) return "Developer";
  return "Unknown";
}

function parseCounterparties(line: string): string[] {
  // "**Frequent GC partners:** Weitz Company, Ryan Companies, Hansen Company"
  const match = line.match(/\*\*[^:*]+:\*\*\s*(.+)$/);
  if (!match) return [];
  return match[1]
    .split(/,|;/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/\(/.test(s)); // skip parenthetical asides
}

/**
 * Parse the watchlist markdown into an array of seed entries.
 *
 * Layout convention (per the file's existing format):
 *   ## Section heading (category)
 *   ### Canonical Entity Name
 *   - **Role:** Developer/Owner/GC/...
 *   - **Notable:** free text
 *   - **Frequent GC partners:** Weitz Company, Ryan Companies, ...
 *   - **LLC pattern:** free text
 *
 * Multi-entity headings like "Microsoft / Apple / Meta (data centers)" are
 * split on " / " into separate entries, sharing the role/notes context.
 */
export function parseWatchlist(markdown: string): WatchlistSeedEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: WatchlistSeedEntry[] = [];
  let currentCategory = "";
  let currentRaw: string | null = null;
  let roleLine: string | null = null;
  let notesParts: string[] = [];
  let counterparties: string[] = [];

  function flush() {
    if (!currentRaw) return;
    // Skip the example skeleton at the bottom of the file ("{Canonical Name}").
    if (currentRaw.includes("{") || currentRaw.includes("}")) {
      currentRaw = null;
      roleLine = null;
      notesParts = [];
      counterparties = [];
      return;
    }
    // Allow "Microsoft / Apple / Meta (data centers)" → 3 entries.
    const names = currentRaw
      .replace(/\(.+?\)/g, "") // strip parenthetical
      .split(" / ")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const name of names) {
      const entityType = inferEntityType(roleLine, currentCategory);
      entries.push({
        rawName: name,
        normalizedName: normalizeEntityName(name),
        entityType,
        category: currentCategory,
        notes: notesParts.length > 0 ? notesParts.join("\n") : null,
        knownCounterparties: counterparties,
      });
    }
    currentRaw = null;
    roleLine = null;
    notesParts = [];
    counterparties = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("## ") && !line.startsWith("###")) {
      flush();
      currentCategory = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("### ")) {
      flush();
      currentRaw = line.slice(4).trim();
      continue;
    }
    if (!currentRaw) continue;

    // Bullet line collection
    const bulletMatch = line.match(/^\s*-\s*(.+)$/);
    if (!bulletMatch) {
      // Section break / blank line / unrelated content
      continue;
    }
    const content = bulletMatch[1];
    if (/^\*\*Role:\*\*/i.test(content)) {
      roleLine = content;
    } else if (/^\*\*(Frequent\s+.+|Typical GCs|Counterparties)[^:*]*:\*\*/i.test(content)) {
      counterparties.push(...parseCounterparties(content));
    }
    notesParts.push(content);
  }
  flush();
  return entries.filter((e) => e.normalizedName.length > 0);
}

// ── Materializer ──────────────────────────────────────────────────────────────

/**
 * Materialize parsed seed entries into the DB.
 *
 * For each entry:
 *  1. Upsert EntityWatchlistSeed row (idempotent on normalizedName).
 *  2. If no Entity exists with the same normalizedName, create one at
 *     reviewStatus=VERIFIED + confidence=VERIFIED with source="watchlist_seed".
 *  3. Returns progress counts.
 *
 * On `dryRun=true`, only counts what WOULD happen — no writes.
 */
export async function materializeSeed(
  entries: WatchlistSeedEntry[],
  opts: { dryRun?: boolean } = {}
): Promise<WatchlistSeedProgress> {
  const startedAt = new Date().toISOString();
  const progress: WatchlistSeedProgress = {
    status: "in_progress",
    startedAt,
    completedAt: null,
    error: null,
    parsedEntries: entries.length,
    materializedSeedRows: 0,
    createdEntities: 0,
    skippedExistingEntities: 0,
  };

  for (const entry of entries) {
    try {
      // EntityWatchlistSeed dedupe — check by (normalizedName, seedSource)
      const existingSeed = await prisma.entityWatchlistSeed.findFirst({
        where: { normalizedName: entry.normalizedName },
      });
      if (!existingSeed && !opts.dryRun) {
        await prisma.entityWatchlistSeed.create({
          data: {
            rawName: entry.rawName,
            normalizedName: entry.normalizedName,
            entityType: entry.entityType,
            category: entry.category,
            notes: entry.notes,
            reviewStatus: "VERIFIED",
            seedSource: "docs/sources/ENTITIES_WATCHLIST.md",
          },
        });
      }
      if (!existingSeed) progress.materializedSeedRows += 1;

      // Entity creation — idempotent on normalizedName
      const existingEntity = await prisma.entity.findFirst({
        where: { normalizedName: entry.normalizedName },
      });
      if (existingEntity) {
        progress.skippedExistingEntities += 1;
      } else if (!opts.dryRun) {
        await prisma.entity.create({
          data: {
            canonicalName: entry.rawName,
            normalizedName: entry.normalizedName,
            entityType: entry.entityType,
            reviewStatus: "VERIFIED",
            confidence: "VERIFIED",
            source: "watchlist_seed",
            notes: entry.notes,
          },
        });
        progress.createdEntities += 1;
      } else {
        progress.createdEntities += 1; // dry-run accounting
      }
    } catch (err) {
      progress.error = err instanceof Error ? err.message : String(err);
      progress.status = "failed";
      progress.completedAt = new Date().toISOString();
      return progress;
    }
  }

  progress.status = "complete";
  progress.completedAt = new Date().toISOString();
  return progress;
}
