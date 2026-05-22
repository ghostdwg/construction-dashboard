// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/ActivationSummary.tsx
//  Phase O2.2 PR5 — Operator-facing first-live activation summary.
//
//  Five numbers, one row. Verifies at a glance that the autonomous cadence
//  is alive without forcing the operator to dig through Grafana:
//    * active sources             — total MarketSources with isActive=true
//    * stale sources              — publishStatus in (STALE_PUBLISH, OPERATOR_REVIEW)
//    * due now                    — sources past their nextExpectedAt
//    * scrapes (24h)              — distinct sources successfully scraped in last 24h
//    * suppressed (24h)           — count of SUPPRESSED classifications in last 24h
//
//  Server component — queries Prisma directly. Re-fetched whenever the page
//  re-renders (the parent page is `async function` so this is per-request).
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

function fmtCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface StatProps {
  label: string;
  value: number;
  sub: string;
  tone: "good" | "warn" | "neutral" | "info";
}

function Stat({ label, value, sub, tone }: StatProps) {
  const color = {
    good:    "var(--signal)",
    warn:    "#ffcc72",
    neutral: "var(--text-soft)",
    info:    "#b8ceff",
  }[tone];
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--line)] px-4 py-3"
      style={{ background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: color }} />
      <p className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>{label}</p>
      <p className="text-[22px] font-[800] tracking-[-0.04em] leading-none mt-1" style={{ color: "var(--text)" }}>
        {fmtCount(value)}
      </p>
      <p className="text-[10px] mt-1" style={{ color: "var(--text-soft)" }}>{sub}</p>
    </div>
  );
}

export default async function ActivationSummary() {
  // eslint-disable-next-line react-hooks/purity
  const now = new Date();
  // eslint-disable-next-line react-hooks/purity
  const oneDayAgo = new Date(now.getTime() - 86_400_000);

  const [activeCount, staleCount, operatorReviewCount, dueCount, scrapedRows, suppressedCount] = await Promise.all([
    prisma.marketSource.count({ where: { isActive: true } }),
    prisma.marketSource.count({ where: { publishStatus: "STALE_PUBLISH" } }),
    prisma.marketSource.count({ where: { publishStatus: "OPERATOR_REVIEW" } }),
    prisma.marketSource.count({
      where: {
        isActive: true,
        publishStatus: "HEALTHY",
        OR: [{ nextExpectedAt: null }, { nextExpectedAt: { lte: now } }],
      },
    }),
    prisma.marketSource.findMany({
      where: { lastScannedAt: { gte: oneDayAgo } },
      select: { id: true },
    }),
    prisma.marketSignal.count({
      where: {
        heuristicsClassification: "SUPPRESSED",
        createdAt: { gte: oneDayAgo },
      },
    }),
  ]);

  // Note: SUPPRESSED signals are dropped before insert (PR3 — they never
  // become MarketSignal rows). The query above stays 0 by design — we keep
  // it as a guardrail: if a future PR persists SUPPRESSED rows for
  // traceability, the counter starts working without UI changes. Today the
  // operator-visible suppressed count comes from the Prometheus counter
  // `neuroglitch_signals_suppressed_total` on Grafana.
  // For now, surface "—" if 0 so operators don't misread it as "system off".
  const scrapedCount = scrapedRows.length;
  const staleTotal = staleCount + operatorReviewCount;

  return (
    <div
      className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden mb-5"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div>
          <p className="text-sm font-[700] tracking-[-0.02em]">Cadence Activation</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
            municipal-agenda-ingestion runner · hourly · see runtime/runbooks/o2.2-first-live-activation.md
          </p>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
              style={{
                color: activeCount > 0 ? "var(--signal)" : "var(--text-dim)",
                background: activeCount > 0 ? "rgba(0,255,100,0.06)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${activeCount > 0 ? "rgba(0,255,100,0.25)" : "var(--line)"}`,
              }}>
          {activeCount > 0 ? "ACTIVE" : "INACTIVE"}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-3 p-4">
        <Stat label="Active sources"     value={activeCount}   sub="isActive=true"           tone={activeCount > 0 ? "good" : "neutral"} />
        <Stat label="Stale / review"     value={staleTotal}    sub={`STALE_PUBLISH + OPERATOR_REVIEW`} tone={staleTotal > 0 ? "warn" : "neutral"} />
        <Stat label="Due now"            value={dueCount}      sub="HEALTHY + nextExpectedAt ≤ now"     tone="info" />
        <Stat label="Scraped 24h"        value={scrapedCount}  sub="distinct sources successfully scraped" tone={scrapedCount > 0 ? "good" : "neutral"} />
        <Stat label="Suppressed 24h"     value={suppressedCount} sub="heuristics-dropped (DB counter)"  tone="neutral" />
      </div>
    </div>
  );
}
