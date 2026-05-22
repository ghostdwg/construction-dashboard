// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/RunnerSummary.tsx
//  Phase O2.2 PR6 — Sidebar card summarizing the most recent runner cycle.
//
//  Server component. Reads RunnerLease + cadence metrics directly. Designed
//  for the right rail of /market-intelligence — small, glanceable, complements
//  the ActivationSummary card above the panels.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

function fmtAge(d: Date | null): string {
  if (!d) return "never";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusColor(status: string | null): string {
  if (status === "succeeded") return "var(--signal)";
  if (status === "failed")    return "var(--red)";
  if (status === "stale")     return "#ffcc72";
  if (status === "running" || status === "claimed") return "#b8ceff";
  return "var(--text-dim)";
}

export default async function RunnerSummary() {
  const runnerName = "municipal-agenda-ingestion";
  // eslint-disable-next-line react-hooks/purity
  const oneDayAgo = new Date(Date.now() - 86_400_000);

  const [lastCycle, cycles24h, scrapedSinceLast] = await Promise.all([
    prisma.runnerLease.findFirst({
      where: { cycleName: runnerName },
      orderBy: { leasedAt: "desc" },
    }),
    prisma.runnerLease.groupBy({
      by: ["status"],
      where: { cycleName: runnerName, leasedAt: { gte: oneDayAgo } },
      _count: { _all: true },
    }),
    // Approximate "sources processed since last cycle" by counting
    // MarketSource rows whose lastScannedAt was bumped after the last
    // RunnerLease.leasedAt. Cheap; lossy if the lease started near tick edge.
    prisma.marketSource.count({
      where: {
        lastScannedAt: { gte: oneDayAgo },
      },
    }),
  ]);

  const ok24h     = cycles24h.find((g) => g.status === "succeeded")?._count._all ?? 0;
  const failed24h = cycles24h.find((g) => g.status === "failed")?._count._all ?? 0;
  const total24h  = cycles24h.reduce((a, g) => a + g._count._all, 0);

  return (
    <div
      className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-sm font-[700] tracking-[-0.02em]">Runner Status</p>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{runnerName}</p>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {/* Last cycle */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Last cycle</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[12px]" style={{ color: "var(--text-soft)" }}>{fmtAge(lastCycle?.leasedAt ?? null)}</span>
            <span
              className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
              style={{
                color: statusColor(lastCycle?.status ?? null),
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--line)",
              }}
            >
              {lastCycle?.status ?? "no cycles yet"}
            </span>
          </div>
          {lastCycle?.durationMs != null && (
            <p className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
              dur {lastCycle.durationMs}ms
            </p>
          )}
          {lastCycle?.errorMessage && (
            <p className="text-[10px] mt-1" style={{ color: "var(--red)" }} title={lastCycle.errorMessage}>
              {lastCycle.errorMessage.slice(0, 60)}
              {lastCycle.errorMessage.length > 60 && "…"}
            </p>
          )}
        </div>

        {/* 24h stats */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Last 24h</p>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <Stat label="cycles" value={total24h} tone="info" />
            <Stat label="ok"     value={ok24h}    tone={failed24h === 0 && ok24h > 0 ? "good" : "neutral"} />
            <Stat label="fail"   value={failed24h} tone={failed24h > 0 ? "bad" : "neutral"} />
          </div>
        </div>

        {/* Source-processing trail */}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Sources scraped 24h</p>
          <p className="text-[18px] font-[700] tracking-[-0.04em] leading-none mt-1" style={{ color: "var(--text)" }}>
            {scrapedSinceLast}
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "good" | "bad" | "info" | "neutral" }) {
  const color = { good: "var(--signal)", bad: "var(--red)", info: "#b8ceff", neutral: "var(--text-soft)" }[tone];
  return (
    <div className="px-2 py-1.5 rounded text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}>
      <p className="text-[14px] font-[700]" style={{ color }}>{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-[0.06em]" style={{ color: "var(--text-dim)" }}>{label}</p>
    </div>
  );
}
