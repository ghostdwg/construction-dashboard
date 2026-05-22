// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/heuristicsContext.ts
//  Phase O2.2 PR3 — Context loader for the deterministic heuristic classifier.
//
//  signalHeuristics.classifySignal() is pure: it takes a SignalContext and
//  returns a verdict. This module is the small, query-efficient adapter that
//  builds that context once per source-scrape from the live DB.
//
//  Hard rules:
//    * One pass per data type. No N+1.
//    * Bounded `take:` on every findMany. No unbounded scans.
//    * Pure JSON.parse with try/catch around per-row metadata (corrupt rows
//      degrade gracefully — never throw).
//    * Same normalization rules as the classifier (re-exports normalizeName).
//    * No I/O outside the explicit prisma calls. No network, no LLM, no embeddings.
//
//  Called by scrapeOneSource once at the start of each source's batch. The
//  resulting SignalContext is then passed verbatim into every
//  persistSidecarPayload call for that source's docs.
// ──────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeName, type SignalContext } from "./signalHeuristics";

// ── Tunables (bounded query windows) ────────────────────────────────────────

/** Look-back window for actor/parcel recurrence. */
const RECENT_NAME_WINDOW_DAYS = 90;
/** Look-back window for jurisdiction velocity. */
const RECENT_JURISDICTION_WINDOW_DAYS = 30;
/** Max signals to read per data-window query. Bounded so a hot region never
 *  produces an unbounded scan. */
const MAX_RECENT_SIGNALS = 1000;
/** Number of recent docs (per source) to pull headlines + packet hashes from. */
const RECENT_DOC_COUNT = 30;
/** Max signals pulled from those recent docs for headline comparison. */
const MAX_RECENT_HEADLINES = 200;

// ── Public utilities ────────────────────────────────────────────────────────

/** Deterministic doc-packet hash. SHA-256 of the doc's raw text, first 16
 *  hex chars (64 bits) — enough to make accidental collision astronomically
 *  unlikely while keeping the value compact for in-memory Sets. */
export function computeDocPacketHash(rawText: string): string {
  return createHash("sha256").update(rawText).digest("hex").slice(0, 16);
}

// ── Internal helpers ────────────────────────────────────────────────────────

function parseMetadata(meta: string | null | undefined): Record<string, unknown> | null {
  if (!meta) return null;
  try {
    const v = JSON.parse(meta);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pushNormalized(set: Set<string>, raw: unknown): void {
  if (typeof raw !== "string") return;
  const n = normalizeName(raw);
  if (n) set.add(n);
}

// ── Public entry point ──────────────────────────────────────────────────────

export interface BuildContextOptions {
  /** Override `now` for deterministic test runs. Defaults to new Date(). */
  now?: Date;
}

/**
 * Build the SignalContext for a single source's scrape. One call =
 * five bounded SELECTs. The returned context is read-only and may be
 * shared across all persistSidecarPayload calls for the source's docs.
 *
 * IMPORTANT: the context reflects DB state at call time. Newly-persisted
 * signals from THIS scrape do NOT appear in the context — only history.
 * That keeps DUPLICATE_CONTINUANCE / DUPLICATE_PACKET from flagging
 * a signal against itself.
 */
export async function buildHeuristicsContext(
  sourceId: string,
  options: BuildContextOptions = {},
): Promise<SignalContext> {
  const now = options.now ?? new Date();
  const cutoff90 = new Date(now.getTime() - RECENT_NAME_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoff30 = new Date(now.getTime() - RECENT_JURISDICTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // ── 1. Recent signals (90d) — drives recurring developer / parcel /
  //       project-key meeting counts. Includes the parent sourceDoc's
  //       jurisdiction so we can build keys without a second query.
  const recentSignals90 = await prisma.marketSignal.findMany({
    where: { createdAt: { gte: cutoff90 } },
    select: {
      metadata: true,
      sourceDocId: true,
      sourceDoc: { select: { jurisdiction: true } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_RECENT_SIGNALS,
  });

  const recentDeveloperNames = new Set<string>();
  const recentParcels = new Set<string>();
  // project-key → set of sourceDocIds it appeared in
  const keyToDocSet = new Map<string, Set<string>>();

  for (const s of recentSignals90) {
    const m = parseMetadata(s.metadata);
    if (m) {
      pushNormalized(recentDeveloperNames, m.owner_name);
      pushNormalized(recentDeveloperNames, m.developer_name);
      pushNormalized(recentDeveloperNames, m.architect_name);
      if (Array.isArray(m.gc_names)) {
        for (const gc of m.gc_names) pushNormalized(recentDeveloperNames, gc);
      }
      if (Array.isArray(m.sub_names)) {
        for (const sub of m.sub_names) pushNormalized(recentDeveloperNames, sub);
      }
      const parcel = typeof m.parcel_id === "string" ? m.parcel_id : null;
      if (parcel) recentParcels.add(parcel);
    }

    // project-key meeting counts
    if (s.sourceDocId) {
      let key: string | null = null;
      if (m) {
        if (typeof m.parcel_id === "string" && m.parcel_id) {
          key = `parcel:${m.parcel_id}`;
        } else if (typeof m.owner_name === "string" && normalizeName(m.owner_name)) {
          key = `actor:${normalizeName(m.owner_name)}`;
        } else if (typeof m.developer_name === "string" && normalizeName(m.developer_name)) {
          key = `actor:${normalizeName(m.developer_name)}`;
        }
      }
      if (!key && s.sourceDoc?.jurisdiction) {
        key = `jurisdiction:${s.sourceDoc.jurisdiction.toLowerCase()}`;
      }
      if (key) {
        let docSet = keyToDocSet.get(key);
        if (!docSet) {
          docSet = new Set();
          keyToDocSet.set(key, docSet);
        }
        docSet.add(s.sourceDocId);
      }
    }
  }

  const projectKeyMeetingCounts = new Map<string, number>();
  for (const [key, docSet] of keyToDocSet) {
    projectKeyMeetingCounts.set(key, docSet.size);
  }

  // ── 2. Recent jurisdiction counts (30d window).
  const recentSignals30 = await prisma.marketSignal.findMany({
    where: { createdAt: { gte: cutoff30 } },
    select: { sourceDoc: { select: { jurisdiction: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_RECENT_SIGNALS,
  });
  const recentJurisdictions = new Map<string, number>();
  for (const s of recentSignals30) {
    const j = s.sourceDoc?.jurisdiction;
    if (j) recentJurisdictions.set(j, (recentJurisdictions.get(j) ?? 0) + 1);
  }

  // ── 3. Recent docs (same source) — for DUPLICATE_CONTINUANCE +
  //       DUPLICATE_PACKET.
  const recentDocs = await prisma.marketSourceDoc.findMany({
    where: { sourceId },
    orderBy: { scannedAt: "desc" },
    take: RECENT_DOC_COUNT,
    select: { id: true, rawText: true },
  });
  const recentDocHashes = new Set<string>();
  const recentDocIds: string[] = [];
  for (const d of recentDocs) {
    if (d.rawText && d.rawText.length > 0) {
      recentDocHashes.add(computeDocPacketHash(d.rawText));
    }
    recentDocIds.push(d.id);
  }

  // ── 4. Recent headlines from those docs.
  const recentHeadlines: string[] = [];
  if (recentDocIds.length > 0) {
    const headlineRows = await prisma.marketSignal.findMany({
      where: { sourceDocId: { in: recentDocIds } },
      select: { headline: true },
      orderBy: { createdAt: "desc" },
      take: MAX_RECENT_HEADLINES,
    });
    for (const r of headlineRows) if (r.headline) recentHeadlines.push(r.headline);
  }

  return {
    recentDeveloperNames,
    recentParcels,
    recentJurisdictions,
    recentHeadlines,
    recentDocHashes,
    projectKeyMeetingCounts,
  };
}

// ── Re-exports for callers that need direct access ──────────────────────────

export { normalizeName };
export const __internals = {
  RECENT_NAME_WINDOW_DAYS,
  RECENT_JURISDICTION_WINDOW_DAYS,
  MAX_RECENT_SIGNALS,
  RECENT_DOC_COUNT,
  MAX_RECENT_HEADLINES,
} as const;
