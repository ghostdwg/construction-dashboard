#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/verify-market-sources.ts
//  Phase O2.2 PR5 — MarketSource URL verifier CLI.
//
//  Usage:
//    tsx scripts/verify-market-sources.ts                    # report only
//    tsx scripts/verify-market-sources.ts --activate          # flip recommended=activate sources to isActive=true
//    tsx scripts/verify-market-sources.ts --quarantine        # flip recommended=remove sources to OPERATOR_REVIEW
//    tsx scripts/verify-market-sources.ts --source=<id>       # verify one specific source
//    tsx scripts/verify-market-sources.ts --dry-run           # run + report; never write
//
//  Exit codes:
//    0 — all sources verified (regardless of recommendation)
//    1 — bad args
//    2 — at least one verification threw (network layer error, not 4xx/5xx)
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { verifyMarketSource, type VerifyResult } from "@/lib/services/marketIntelligence/verifyMarketSource";

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(`--${name}`);
const getFlag = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};

async function main(): Promise<number> {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(`Usage: tsx scripts/verify-market-sources.ts [flags]

Flags:
  --activate           Flip isActive=true on sources whose verifier recommended=activate.
  --quarantine         Flip publishStatus=OPERATOR_REVIEW on sources whose recommended=remove.
  --source=<id>        Verify a single source by id (default: all).
  --dry-run            Verify + report; never write back to the DB.
  --timeout-ms=<N>     Per-source fetch timeout (default 12000).
  --concurrency=<N>    Parallel verifications (default 4).
`);
    return 0;
  }

  const activate    = hasFlag("activate");
  const quarantine  = hasFlag("quarantine");
  const dryRun      = hasFlag("dry-run");
  const sourceId    = getFlag("source");
  const timeoutMs   = Number(getFlag("timeout-ms") ?? "12000");
  const concurrency = Math.max(1, Math.min(16, Number(getFlag("concurrency") ?? "4")));

  const where = sourceId ? { id: sourceId } : {};
  const sources = await prisma.marketSource.findMany({
    where,
    select: { id: true, name: true, url: true, isActive: true, publishStatus: true, sourceType: true, jurisdiction: true },
    orderBy: [{ jurisdiction: "asc" }, { name: "asc" }],
  });

  if (sources.length === 0) {
    console.log(`[verify-market-sources] no sources matched. Have you run \`npm run seed:market-sources\`?`);
    return 0;
  }

  console.log(`[verify-market-sources] verifying ${sources.length} source(s) (concurrency=${concurrency}, timeout=${timeoutMs}ms)`);

  const results: VerifyResult[] = [];
  let networkThrowCount = 0;

  // Simple bounded-parallelism: chunk into groups of `concurrency`.
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (s) => {
      try {
        return await verifyMarketSource({ sourceId: s.id, name: s.name, url: s.url }, { timeoutMs });
      } catch (err) {
        networkThrowCount += 1;
        const message = err instanceof Error ? err.message : String(err);
        return {
          sourceId: s.id, url: s.url, reachable: false, status: null, contentType: null,
          detectedStack: "UNKNOWN_STACK" as const,
          bodyPreview: null, candidateLinkCount: 0,
          errorMessage: `verifier threw: ${message}`,
          recommendation: "remove" as const, reason: "verifier exception",
          verifyVersion: "v1" as const,
        };
      }
    }));
    results.push(...batchResults);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const summary = { activate: 0, investigate: 0, remove: 0 };
  console.log(`[verify-market-sources] results:`);
  for (const r of results) {
    const src = sources.find((s) => s.id === r.sourceId)!;
    summary[r.recommendation] += 1;
    const tag = r.recommendation.toUpperCase().padEnd(11);
    const statusStr = r.reachable ? `HTTP ${r.status} ${r.detectedStack} links=${r.candidateLinkCount}` : `UNREACHABLE`;
    console.log(`  [${tag}] ${src.jurisdiction.padEnd(20)} ${src.name.slice(0, 45).padEnd(45)} ${statusStr}`);
    if (r.errorMessage) console.log(`             └─ ${r.errorMessage}`);
  }
  console.log(`[verify-market-sources] summary: activate=${summary.activate}  investigate=${summary.investigate}  remove=${summary.remove}`);

  // ── Optional writes ──────────────────────────────────────────────────────
  if (dryRun) {
    console.log(`[verify-market-sources] dry-run — no DB writes`);
    return networkThrowCount > 0 ? 2 : 0;
  }

  let activated = 0;
  let quarantined = 0;
  for (const r of results) {
    const src = sources.find((s) => s.id === r.sourceId)!;
    if (activate && r.recommendation === "activate" && !src.isActive) {
      await prisma.marketSource.update({
        where: { id: src.id },
        data: { isActive: true, publishStatus: "HEALTHY" },
      });
      activated += 1;
    } else if (quarantine && r.recommendation === "remove" && src.publishStatus !== "OPERATOR_REVIEW") {
      await prisma.marketSource.update({
        where: { id: src.id },
        data: { publishStatus: "OPERATOR_REVIEW" },
      });
      quarantined += 1;
    }
  }

  if (activate || quarantine) {
    console.log(`[verify-market-sources] writes: activated=${activated}  quarantined=${quarantined}`);
  }

  return networkThrowCount > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[verify-market-sources] FATAL", err);
    process.exit(1);
  });
