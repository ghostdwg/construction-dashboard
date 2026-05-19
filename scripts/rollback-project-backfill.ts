// ──────────────────────────────────────────────────────────────────────────────
//  scripts/rollback-project-backfill.ts
//  Phase MI-6 PR2 — Selective rollback of historical project aggregation.
//
//  Default policy:
//   - Detaches every non-detached ProjectSignal whose attachReason indicates
//     backfill origin (signalKind ∈ MARKET_SIGNAL/RELATIONSHIP_EDGE/MARKET_LEAD
//     and source pointer set) by setting detachedAt + detachedReason. The row
//     itself is preserved for audit.
//   - Marks every Project whose source starts with "backfill_" as REJECTED
//     with a forwarding note (NOT deleted). Operator manually purges if
//     desired.
//   - Optionally deletes (with --purge) projects that have NO signals
//     remaining after the detach pass — cleanup for pure-backfill aggregates
//     that were never operator-touched.
//
//  Tier fence identical to the forward CLI.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { BackfillTier } from "@/lib/services/projectBackfill";

function fail(msg: string, code = 1): never {
  console.error(`[project-rollback] FATAL: ${msg}`);
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
  const appEnv = process.env.APP_ENV;
  if (!appEnv) fail("APP_ENV is required");
  if (
    (tier === "production" && appEnv !== "production") ||
    (tier === "staging" && appEnv !== "staging") ||
    (tier === "development-parity" && appEnv !== "local" && appEnv !== "development-parity")
  ) {
    fail(`Tier fence: --tier=${tier} but APP_ENV=${appEnv}. Refusing.`);
  }

  console.log(`[project-rollback] tier=${tier} APP_ENV=${appEnv}`);

  const dryRun = flag("dry-run");
  const purge = flag("purge");

  // Inventory
  const [backfillSignalCount, backfillProjectCount] = await Promise.all([
    prisma.projectSignal.count({
      where: {
        detachedAt: null,
        OR: [
          { sourceMarketSignalId: { not: null } },
          { sourceRelationshipEdgeId: { not: null } },
          { sourceMarketLeadId: { not: null } },
        ],
      },
    }),
    prisma.project.count({ where: { source: { startsWith: "backfill_" } } }),
  ]);

  console.log(`[project-rollback] Would detach ${backfillSignalCount} ProjectSignal rows`);
  console.log(`[project-rollback] Would mark ${backfillProjectCount} Project rows as REJECTED`);
  if (purge) console.log("[project-rollback] --purge: orphan projects without any active signals WILL be deleted.");

  if (dryRun) {
    console.log("[project-rollback] --dry-run — exiting without writes");
    return;
  }
  if (!flag("yes")) fail("Add --yes to confirm. Aborting.");

  await prisma.$transaction(async (tx) => {
    const ts = new Date();
    await tx.projectSignal.updateMany({
      where: {
        detachedAt: null,
        OR: [
          { sourceMarketSignalId: { not: null } },
          { sourceRelationshipEdgeId: { not: null } },
          { sourceMarketLeadId: { not: null } },
        ],
      },
      data: {
        detachedAt: ts,
        detachedReason: "rollback_project_backfill",
        detachedBy: "system",
      },
    });

    await tx.project.updateMany({
      where: { source: { startsWith: "backfill_" } },
      data: {
        reviewStatus: "REJECTED",
        notes: `Auto-REJECTED by project-backfill rollback at ${ts.toISOString()}`,
      },
    });
  });

  console.log("[project-rollback] Detach + REJECT phase complete.");

  if (purge) {
    // Orphan detection: a backfill-created project with no active signals
    // attached AND no operator-attached entities or parcels can be deleted.
    const orphanCandidates = await prisma.project.findMany({
      where: { source: { startsWith: "backfill_" }, reviewStatus: "REJECTED" },
      select: {
        id: true,
        _count: {
          select: {
            signals: { where: { detachedAt: null } },
            entities: { where: { removed: false } },
            parcels: true,
          },
        },
      },
    });
    const purgeable = orphanCandidates.filter(
      (p) => p._count.signals === 0 && p._count.entities === 0 && p._count.parcels === 0
    );
    if (purgeable.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: purgeable.map((p) => p.id) } } });
      console.log(`[project-rollback] Purged ${purgeable.length} orphan project(s).`);
    } else {
      console.log("[project-rollback] No orphan projects eligible for purge.");
    }
  }

  console.log("[project-rollback] Complete. Re-run backfill to repopulate.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
