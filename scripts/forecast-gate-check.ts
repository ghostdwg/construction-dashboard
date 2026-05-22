#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/forecast-gate-check.ts
//  Phase O2.2 PR7 — Pre-flight gating report for the forecast-daily runner.
//
//  Usage:
//    tsx scripts/forecast-gate-check.ts                # human-readable
//    tsx scripts/forecast-gate-check.ts --json         # machine-readable
//
//  Exit codes:
//    0 — all gates pass (forecast-daily would execute work this cycle)
//    1 — at least one gate failed (runner would no-op)
// ──────────────────────────────────────────────────────────────────────────────

import { checkForecastGates } from "@/lib/services/emergenceProbability";

const args = process.argv.slice(2);
const isJson = args.includes("--json");

async function main(): Promise<number> {
  const report = await checkForecastGates();

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.gatesPass ? 0 : 1;
  }

  console.log(`[forecast-gate-check] ${report.gatesPass ? "PASS" : "FAIL"} — ${report.results.length} gate(s)`);
  for (const g of report.results) {
    const tag = g.pass ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${g.name}: ${g.detail}`);
  }
  if (!report.gatesPass) {
    console.log("");
    console.log("forecast-daily runner is currently soft-gated. It will no-op on each tick");
    console.log("until all gates pass. Re-run this command after addressing the failing gate(s).");
  }
  return report.gatesPass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[forecast-gate-check] FATAL", err);
    process.exit(2);
  });
