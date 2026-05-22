#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/seed-market-sources.ts
//  Phase O2.2 PR5 — Des Moines metro MarketSource seeder.
//
//  Usage:
//    tsx scripts/seed-market-sources.ts --dry-run
//    tsx scripts/seed-market-sources.ts                  # creates inactive
//    tsx scripts/seed-market-sources.ts --activate       # creates active
//
//  Exit codes:
//    0 — seed completed (created + alreadyExisted reported)
//    1 — bad args
//    2 — partial failure (some rows could not be created)
//
//  See lib/services/marketIntelligence/seedSources.ts for data + helper.
//  See runtime/runbooks/o2.2-first-live-activation.md for activation flow.
// ──────────────────────────────────────────────────────────────────────────────

import { DES_MOINES_METRO_SEEDS, executeSeed } from "@/lib/services/marketIntelligence/seedSources";

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(`--${name}`);

async function main(): Promise<number> {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(`Usage: tsx scripts/seed-market-sources.ts [--dry-run] [--activate]

Seeds the Des Moines metro MarketSource set defined in
lib/services/marketIntelligence/seedSources.ts.

Flags:
  --dry-run    Report what would be created; no DB writes.
  --activate   Set isActive=true on newly-created rows. WITHOUT this flag,
               sources are created with isActive=false — the verify script
               (or operator UI) flips them on after URL verification.
`);
    return 0;
  }

  const dryRun = hasFlag("dry-run");
  const activate = hasFlag("activate");

  console.log(`[seed-market-sources] seeds=${DES_MOINES_METRO_SEEDS.length} dryRun=${dryRun} activate=${activate}`);
  const result = await executeSeed(DES_MOINES_METRO_SEEDS, { activate, dryRun });

  console.log(`[seed-market-sources] total=${result.total} created=${result.created} alreadyExisted=${result.alreadyExisted} errors=${result.errors.length}`);

  if (result.createdSources.length > 0) {
    console.log(`[seed-market-sources] new rows:`);
    for (const s of result.createdSources) {
      console.log(`  + ${s.jurisdiction} — ${s.name}${dryRun ? "  (dry-run)" : ""}`);
    }
  }

  if (result.errors.length > 0) {
    console.error(`[seed-market-sources] errors:`);
    for (const e of result.errors) {
      console.error(`  ! ${e.name}: ${e.error}`);
    }
    return 2;
  }

  if (dryRun) {
    console.log(`[seed-market-sources] dry-run complete. Re-run without --dry-run to write.`);
  } else if (!activate) {
    console.log(`[seed-market-sources] Done. New rows are isActive=false. Next:`);
    console.log(`  npm run verify:market-sources -- --activate`);
  } else {
    console.log(`[seed-market-sources] Done. ${result.created} active source(s) added — runner will pick them up on the next hourly cycle.`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[seed-market-sources] FATAL", err);
    process.exit(1);
  });
