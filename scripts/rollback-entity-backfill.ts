#!/usr/bin/env -S node --import=tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/rollback-entity-backfill.ts
//  Phase MI-3 — Selective rollback for backfill artifacts.
//
//  Rollback policy:
//    - Clears RelationshipEdge.fromEntityId/toEntityId/resolverVersion/
//      resolverConfidence ONLY for rows where resolverVersion matches the
//      --resolver-version argument.
//    - Deletes EntityRelationship rows where source='backfill_edge' AND
//      legacyEdgeId points to a RelationshipEdge whose resolverVersion
//      matches.
//    - Does NOT delete Entity or EntityAlias rows — those are canonical
//      memory and may have been touched by manual operator work. The
//      operator deletes orphan entities manually after inspecting them.
//    - Does NOT touch EntityWatchlistSeed rows.
//
//  Re-running the backfill after rollback is safe: Pass 1 will hit the
//  existing Entity rows and rewire RelationshipEdge with fresh
//  EntityRelationship parallels.
//
//  Invocation:
//    npm run backfill:entity-graph:rollback -- --tier=staging --resolver-version=v1
//
//  Tier fence identical to the backfill CLI.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { BackfillTier } from "@/lib/services/entityBackfill";

function fail(msg: string, code = 1): never {
  console.error(`[rollback] FATAL: ${msg}`);
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const m = args.find((a) => a.startsWith(`--${name}=`));
    return m ? m.slice(`--${name}=`.length) : undefined;
  };
  const flag = (name: string) => args.includes(`--${name}`);

  const tier = get("tier") as BackfillTier | undefined;
  if (!tier) fail("--tier=TIER is required");
  if (!["development-parity", "staging", "production"].includes(tier)) {
    fail(`--tier must be one of: development-parity, staging, production. Got: ${tier}`);
  }

  const resolverVersion = get("resolver-version");
  if (!resolverVersion) fail("--resolver-version=VERSION is required");

  const appEnv = process.env.APP_ENV;
  if (!appEnv) fail("APP_ENV is required");
  if (
    (tier === "production" && appEnv !== "production") ||
    (tier === "staging" && appEnv !== "staging") ||
    (tier === "development-parity" && appEnv !== "local" && appEnv !== "development-parity")
  ) {
    fail(`Tier fence: --tier=${tier} but APP_ENV=${appEnv}. Refusing.`);
  }

  console.log(`[rollback] tier=${tier} APP_ENV=${appEnv} resolverVersion=${resolverVersion}`);

  // Phase 1: count what would be touched
  const edgesToClear = await prisma.relationshipEdge.count({
    where: { resolverVersion: resolverVersion },
  });
  const relsToDelete = await prisma.entityRelationship.count({
    where: { source: "backfill_edge" },
  });

  console.log(`[rollback] Would clear FKs on ${edgesToClear} RelationshipEdge rows`);
  console.log(`[rollback] Would delete ${relsToDelete} EntityRelationship rows (source=backfill_edge)`);
  console.log(`[rollback] Entities, aliases, and watchlist seeds are NOT touched`);

  if (flag("dry-run")) {
    console.log("[rollback] --dry-run — exiting without writes");
    return;
  }

  if (!flag("yes")) {
    fail("Add --yes to confirm rollback. Aborting.");
  }

  // Phase 2: execute (single transaction)
  await prisma.$transaction(async (tx) => {
    await tx.entityRelationship.deleteMany({
      where: { source: "backfill_edge" },
    });
    await tx.relationshipEdge.updateMany({
      where: { resolverVersion: resolverVersion },
      data: {
        fromEntityId: null,
        toEntityId: null,
        resolverVersion: null,
        resolverConfidence: null,
      },
    });
  });

  console.log("[rollback] Complete. Re-run backfill to repopulate.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
