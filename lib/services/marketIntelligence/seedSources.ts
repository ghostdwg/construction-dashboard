// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/seedSources.ts
//  Phase O2.2 PR5 — Des Moines metro MarketSource seed data + idempotent upsert.
//
//  Design rules:
//    * Pure data + a thin DB helper. No CLI parsing here (see
//      scripts/seed-market-sources.ts for that).
//    * Idempotent: re-running the seeder NEVER duplicates rows. Identity
//      key is (jurisdiction, sourceType, normalizedName).
//    * Replay-safe: dry-run mode reports what WOULD be created without
//      writing.
//    * Additive-only: never mutates existing rows. Operators tune sources
//      via the SourcesPanel (PATCH /api/.../sources) post-seed.
//    * Safe default — created sources are isActive=FALSE. The CLI exposes
//      `--activate` to flip them on; the verify script flips ONLY verified
//      sources on. This prevents accidentally pointing the autonomous
//      runner at unverified URLs.
//
//  URLs are best-guess CivicPlus AgendaCenter patterns for Iowa metros.
//  Operators MUST run scripts/verify-market-sources.ts before activation —
//  some URLs will be wrong (city renamed page, retired stack, moved subdomain).
//  See runtime/runbooks/o2.2-first-live-activation.md.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export type SeedSourceType = "planning_commission" | "city_council" | "utility_board";
export type SeedPrefilterMode = "off" | "large" | "always";

export interface SeedSource {
  /** Operator-visible label. Must be globally unique within the seed set. */
  name: string;
  /** "City of Ankeny", "Polk County", etc. Lowercased + collapsed for dedup. */
  jurisdiction: string;
  sourceType: SeedSourceType;
  /** Best-guess URL. Verify before activation. */
  url: string;
  prefilterMode: SeedPrefilterMode;
  /** 60 = standard floor. 70 for utility-board (high noise) to suppress
   *  operational items even when keyword/heuristic boosts fire. */
  minRelevanceScore: number;
  /** Initial cadence estimate (days). Refined automatically by
   *  recomputeCadence after the first few real scrapes. null = unknown. */
  publishCadenceDaysInitial: number | null;
  /** Free-text operator note. Not persisted; surfaced in seed log only. */
  note?: string;
}

// ── The Des Moines metro seed set (PR5 starting list) ──────────────────────
//
// Targets ~15-20 sources per o2.1-first-bloodstream.md §2 + PR5 spec.
// Source classes: planning & zoning agendas (primary), city council
// agendas (secondary — many ratify P&Z items giving a second-touch signal),
// utility-board agendas (sparse, 2-3 only, prefilterMode=always to suppress
// rate/billing items).

export const DES_MOINES_METRO_SEEDS: readonly SeedSource[] = Object.freeze([
  // ── Core metro P&Z ────────────────────────────────────────────────────────
  {
    name: "City of Des Moines — Plan & Zoning Commission",
    jurisdiction: "Des Moines",
    sourceType: "planning_commission",
    url: "https://www.dsm.city/AgendaCenter",
    prefilterMode: "large",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 14,
    note: "DSM is the metro's largest emergence corridor; high signal volume expected.",
  },
  {
    name: "Polk County — Planning & Zoning Commission",
    jurisdiction: "Polk County",
    sourceType: "planning_commission",
    url: "https://www.polkcountyiowa.gov/AgendaCenter",
    prefilterMode: "large",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 21,
    note: "County-level zoning covers unincorporated land — annexation precursor signal.",
  },
  {
    name: "West Des Moines — Plan & Zoning Commission",
    jurisdiction: "West Des Moines",
    sourceType: "planning_commission",
    url: "https://www.wdm.iowa.gov/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 14,
    note: "Jordan Creek corridor + west-side commercial expansion.",
  },
  {
    name: "Ankeny — Planning & Zoning Commission",
    jurisdiction: "Ankeny",
    sourceType: "planning_commission",
    url: "https://www.ankenyiowa.gov/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 14,
    note: "Fastest-growing suburb; expect heavy plat + site-plan throughput.",
  },
  {
    name: "Waukee — Planning & Zoning Commission",
    jurisdiction: "Waukee",
    sourceType: "planning_commission",
    url: "https://www.waukee.org/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 21,
    note: "Microsoft datacenter region — industrial rezoning signal source.",
  },
  {
    name: "Johnston — Planning & Zoning Commission",
    jurisdiction: "Johnston",
    sourceType: "planning_commission",
    url: "https://www.cityofjohnston.com/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 21,
    note: "North-metro corridor; medium-density commercial.",
  },
  {
    name: "Urbandale — Planning & Zoning Commission",
    jurisdiction: "Urbandale",
    sourceType: "planning_commission",
    url: "https://www.urbandale.org/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 21,
    note: "Mature suburb; redevelopment + site-plan amendments dominate.",
  },
  {
    name: "Clive — Planning & Zoning Commission",
    jurisdiction: "Clive",
    sourceType: "planning_commission",
    url: "https://www.cityofclive.com/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 28,
    note: "Smaller jurisdiction; expect lower volume — cadence learning will tighten.",
  },
  {
    name: "Altoona — Planning & Zoning Commission",
    jurisdiction: "Altoona",
    sourceType: "planning_commission",
    url: "https://www.altoona-iowa.com/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 21,
    note: "Facebook data center adjacency; industrial/logistics signals.",
  },
  {
    name: "Norwalk — Planning & Zoning Commission",
    jurisdiction: "Norwalk",
    sourceType: "planning_commission",
    url: "https://www.ci.norwalk.ia.us/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 28,
    note: "South-metro growth corridor.",
  },
  {
    name: "Bondurant — Planning & Zoning Commission",
    jurisdiction: "Bondurant",
    sourceType: "planning_commission",
    url: "https://www.cityofbondurant.com/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 28,
    note: "Logistics/warehouse corridor (Amazon-adjacent).",
  },
  {
    name: "Grimes — Planning & Zoning Commission",
    jurisdiction: "Grimes",
    sourceType: "planning_commission",
    url: "https://www.grimesiowa.gov/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 28,
    note: "Northwest growth band; medium volume.",
  },
  {
    name: "Pleasant Hill — Planning & Zoning Commission",
    jurisdiction: "Pleasant Hill",
    sourceType: "planning_commission",
    url: "https://www.pleasanthilliowa.org/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 30,
    note: "East-metro emerging corridor.",
  },
  {
    name: "Indianola — Planning & Zoning Commission",
    jurisdiction: "Indianola",
    sourceType: "planning_commission",
    url: "https://www.indianolaiowa.gov/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 30,
    note: "Warren County seat; institutional + commercial mix.",
  },
  {
    name: "Carlisle — Planning & Zoning Commission",
    jurisdiction: "Carlisle",
    sourceType: "planning_commission",
    url: "https://www.carlisleiowa.com/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 30,
    note: "Sparse cadence expected; long learning window.",
  },
  {
    name: "Polk City — Planning & Zoning Commission",
    jurisdiction: "Polk City",
    sourceType: "planning_commission",
    url: "https://www.polkcityia.gov/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 30,
    note: "Lakeside small-city; mostly residential, occasional commercial signal.",
  },
  {
    name: "Mitchellville — Planning & Zoning Commission",
    jurisdiction: "Mitchellville",
    sourceType: "planning_commission",
    url: "https://www.cityofmitchellville.com/AgendaCenter",
    prefilterMode: "off",
    minRelevanceScore: 60,
    publishCadenceDaysInitial: 45,
    note: "Smallest seed source; expect sparse cadence + early STALE_PUBLISH risk.",
  },

  // ── Council ratification feeds (secondary — most P&Z items pass through) ──
  {
    name: "City of Des Moines — City Council",
    jurisdiction: "Des Moines",
    sourceType: "city_council",
    url: "https://www.dsm.city/AgendaCenter",
    prefilterMode: "large",
    minRelevanceScore: 65,
    publishCadenceDaysInitial: 14,
    note: "Council ratifies P&Z items + acts on bonds/TIF/contract awards.",
  },
  {
    name: "West Des Moines — City Council",
    jurisdiction: "West Des Moines",
    sourceType: "city_council",
    url: "https://www.wdm.iowa.gov/AgendaCenter",
    prefilterMode: "large",
    minRelevanceScore: 65,
    publishCadenceDaysInitial: 14,
  },

  // ── Utility board (sparse — high noise floor) ─────────────────────────────
  {
    name: "Des Moines Water Works — Board of Trustees",
    jurisdiction: "Des Moines",
    sourceType: "utility_board",
    url: "https://www.dmww.com/about/board-of-trustees/",
    prefilterMode: "always",
    minRelevanceScore: 70,
    publishCadenceDaysInitial: 30,
    note: "Watermain/utility-expansion signal source. prefilterMode=always to suppress rate/billing noise.",
  },
]);

// ── Identity helpers (used by upsert dedup) ────────────────────────────────

/** Collapse whitespace + lowercase for stable identity comparison. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Identity key for dedup. Accepts plain strings so DB-returned rows (whose
 *  sourceType column is `string`, not the SeedSourceType enum) can be hashed
 *  identically to seed objects. */
export function seedIdentityKey(seed: { name: string; jurisdiction: string; sourceType: string }): string {
  return `${normalize(seed.jurisdiction)}|${normalize(seed.sourceType)}|${normalize(seed.name)}`;
}

// ── Public seeder ──────────────────────────────────────────────────────────

export interface SeedExecutionResult {
  total: number;
  created: number;
  alreadyExisted: number;
  errors: Array<{ name: string; error: string }>;
  createdSources: Array<{ id: string; name: string; jurisdiction: string }>;
  dryRun: boolean;
  activated: boolean;
}

export interface SeedExecutionOptions {
  /** When true, set isActive=true on newly-created rows. Default false —
   *  the verify script (or operator) flips isActive after URL validation. */
  activate?: boolean;
  /** When true, report what WOULD be created without writing. */
  dryRun?: boolean;
}

/**
 * Idempotently seed a set of MarketSource rows. Existing rows (matched by
 * jurisdiction + sourceType + name) are SKIPPED — never mutated. Re-running
 * the seeder is therefore safe and converges on the seed set.
 *
 * Newly-created rows default to isActive=false / publishStatus='HEALTHY'.
 * Operator-driven activation flow:
 *   1. `npm run seed:market-sources -- --dry-run`        review
 *   2. `npm run seed:market-sources`                     create (inactive)
 *   3. `npm run verify:market-sources -- --activate`     verify + flip active
 *   4. (or) operator flips active via SourcesPanel
 */
export async function executeSeed(
  seeds: readonly SeedSource[],
  options: SeedExecutionOptions = {},
): Promise<SeedExecutionResult> {
  const activate = options.activate ?? false;
  const dryRun = options.dryRun ?? false;

  let created = 0;
  let alreadyExisted = 0;
  const errors: SeedExecutionResult["errors"] = [];
  const createdSources: SeedExecutionResult["createdSources"] = [];

  // Existing source set for the metro — keyed by identity. One findMany +
  // in-memory dedup keeps this O(seeds + existing) instead of O(seeds * existing).
  const existing = await prisma.marketSource.findMany({
    where: {
      OR: seeds.map((s) => ({
        AND: [
          { jurisdiction: s.jurisdiction },
          { sourceType: s.sourceType },
          { name: s.name },
        ],
      })),
    },
    select: { id: true, name: true, jurisdiction: true, sourceType: true },
  });
  const existingKeys = new Set(existing.map((e) => seedIdentityKey(e)));

  for (const seed of seeds) {
    const key = seedIdentityKey(seed);
    if (existingKeys.has(key)) {
      alreadyExisted += 1;
      continue;
    }

    if (dryRun) {
      created += 1;
      createdSources.push({ id: "(dry-run)", name: seed.name, jurisdiction: seed.jurisdiction });
      continue;
    }

    try {
      const row = await prisma.marketSource.create({
        data: {
          name: seed.name,
          jurisdiction: seed.jurisdiction,
          sourceType: seed.sourceType,
          url: seed.url,
          isActive: activate,
          publishStatus: "HEALTHY",
          consecutiveEmptyRuns: 0,
          prefilterMode: seed.prefilterMode,
          prefilterCharThreshold: 30000,
          prefilterModel: null,
          minRelevanceScore: seed.minRelevanceScore,
          minEstimatedValue: null,
          projectTypeAllowlist: null,
          publishCadenceDays: seed.publishCadenceDaysInitial,
          // cadenceConfidence + sampleSize left null — first real scrape's
          // recomputeCadence will populate them.
        },
      });
      created += 1;
      createdSources.push({ id: row.id, name: row.name, jurisdiction: row.jurisdiction });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ name: seed.name, error: message });
    }
  }

  return {
    total: seeds.length,
    created,
    alreadyExisted,
    errors,
    createdSources,
    dryRun,
    activated: activate && !dryRun,
  };
}
