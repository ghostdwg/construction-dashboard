// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/activation/page.tsx
//  Phase O2.2 PR6 — Full activation report page.
//
//  Operator-facing detailed view of the same data the activation-report CLI
//  emits. Use during + after first-live activation; complements the compact
//  ActivationSummary card on the main /market-intelligence page.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { buildActivationReport } from "@/lib/services/marketIntelligence/activationReport";

function fmtAge(d: Date | null): string {
  if (!d) return "—";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  const map: Record<string, { color: string; bg: string }> = {
    succeeded: { color: "var(--signal)", bg: "rgba(0,255,100,0.06)" },
    failed:    { color: "var(--red)",    bg: "rgba(255,80,80,0.08)" },
    stale:     { color: "#ffcc72",       bg: "rgba(245,166,35,0.08)" },
    running:   { color: "#b8ceff",       bg: "rgba(126,167,255,0.08)" },
    claimed:   { color: "#b8ceff",       bg: "rgba(126,167,255,0.08)" },
  };
  const m = map[status] ?? { color: "var(--text-dim)", bg: "rgba(255,255,255,0.04)" };
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
          style={{ color: m.color, background: m.bg, border: "1px solid var(--line)" }}>
      {status}
    </span>
  );
}

function PublishStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string }> = {
    HEALTHY:         { color: "var(--signal)", bg: "rgba(0,255,100,0.06)" },
    STALE_PUBLISH:   { color: "#ffcc72",       bg: "rgba(245,166,35,0.1)" },
    OPERATOR_REVIEW: { color: "var(--red)",    bg: "rgba(255,80,80,0.08)" },
  };
  const m = map[status] ?? { color: "var(--text-dim)", bg: "rgba(255,255,255,0.04)" };
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
          style={{ color: m.color, background: m.bg, border: "1px solid var(--line)" }}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function HeuristicBandBadge({ classification }: { classification: string | null }) {
  if (!classification) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  const map: Record<string, string> = {
    HIGH_EMERGENCE:   "var(--signal)",
    MEDIUM_EMERGENCE: "#ffcc72",
    LOW_EMERGENCE:    "var(--text-soft)",
    SUPPRESSED:       "var(--red)",
  };
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.07em]"
          style={{ color: map[classification] ?? "var(--text-dim)" }}>
      {classification.replace(/_/g, " ")}
    </span>
  );
}

export default async function ActivationReportPage() {
  const report = await buildActivationReport();

  return (
    <div>
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // market intelligence // activation
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Activation Report
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            First-live operational audit · generated {report.generatedAt.toISOString()} · v{report.version}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/market-intelligence"
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.07em] rounded-md"
            style={{ border: "1px solid var(--line)", color: "var(--text-soft)", background: "rgba(255,255,255,0.02)" }}
          >
            ← Back
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 p-6">
        {/* ── Source status ──────────────────────────────────────────────── */}
        <Section title="Source status">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: "var(--text-dim)" }}>
                <th className="text-left font-mono text-[9px] uppercase tracking-[0.07em] pb-1">publishStatus</th>
                <th className="text-left font-mono text-[9px] uppercase tracking-[0.07em] pb-1">active</th>
                <th className="text-right font-mono text-[9px] uppercase tracking-[0.07em] pb-1">count</th>
              </tr>
            </thead>
            <tbody>
              {report.sourceStatus.length === 0 ? (
                <tr><td colSpan={3} className="py-3 text-center" style={{ color: "var(--text-dim)" }}>no sources seeded</td></tr>
              ) : (
                report.sourceStatus.map((s, i) => (
                  <tr key={i} className="border-t border-[var(--line)]">
                    <td className="py-1"><PublishStatusBadge status={s.publishStatus} /></td>
                    <td className="py-1" style={{ color: s.isActive ? "var(--signal)" : "var(--text-dim)" }}>{String(s.isActive)}</td>
                    <td className="py-1 text-right font-mono">{s.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Section>

        {/* ── Cadence distribution ────────────────────────────────────────── */}
        <Section title="Cadence-confidence distribution">
          <div className="grid grid-cols-4 gap-2">
            {(["high", "medium", "low", "none"] as const).map((k) => (
              <div key={k} className="px-3 py-2 rounded text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}>
                <p className="text-[18px] font-[700]" style={{ color: k === "high" ? "var(--signal)" : k === "medium" ? "#ffcc72" : "var(--text-soft)" }}>
                  {report.cadenceConfidenceDistribution[k]}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-[0.06em]" style={{ color: "var(--text-dim)" }}>{k}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Runner cycles ───────────────────────────────────────────────── */}
        <Section title="Runner cycles (last 24h)" wide>
          {report.runnerCycles.map((r) => (
            <div key={r.cycleName} className="border-t border-[var(--line)] py-2 first:border-t-0">
              <p className="text-[12px] font-[600]">{r.cycleName}</p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>total24h={r.totalLast24h}</span>
                <span className="font-mono text-[10px]" style={{ color: "var(--signal)" }}>ok={r.succeeded24h}</span>
                <span className="font-mono text-[10px]" style={{ color: r.failed24h > 0 ? "var(--red)" : "var(--text-dim)" }}>fail={r.failed24h}</span>
                <span className="font-mono text-[10px]" style={{ color: r.staleLeases > 0 ? "#ffcc72" : "var(--text-dim)" }}>stale={r.staleLeases}</span>
                <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>· last {fmtAge(r.lastCycleAt)}</span>
                <StatusBadge status={r.lastCycleStatus} />
              </div>
              {r.lastCycleError && (
                <p className="font-mono text-[10px] mt-1" style={{ color: "var(--red)" }} title={r.lastCycleError}>
                  ⚠ {r.lastCycleError.slice(0, 100)}{r.lastCycleError.length > 100 && "…"}
                </p>
              )}
            </div>
          ))}
        </Section>

        {/* ── Ingestion throughput ───────────────────────────────────────── */}
        <Section title="Ingestion throughput">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="1h"  value={report.ingestionThroughput.signalsLast1h} tone="info" />
            <Stat label="24h" value={report.ingestionThroughput.signalsLast24h} tone="info" />
            <Stat label="7d"  value={report.ingestionThroughput.signalsLast7d} tone="info" />
          </div>
          <p className="font-mono text-[10px] mt-3" style={{ color: "var(--text-dim)" }}>classification (24h)</p>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <Stat label="HIGH" value={report.ingestionThroughput.highEmergence24h} tone="good" />
            <Stat label="MED"  value={report.ingestionThroughput.mediumEmergence24h} tone="warn" />
            <Stat label="LOW"  value={report.ingestionThroughput.lowEmergence24h} tone="neutral" />
          </div>
        </Section>

        {/* ── Project formation ──────────────────────────────────────────── */}
        <Section title="Project formation">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="projects 24h"          value={report.projectFormation.projectsCreatedLast24h} tone="info" />
            <Stat label="projects 7d"           value={report.projectFormation.projectsCreatedLast7d} tone="info" />
            <Stat label="ingestion-attrib 7d"   value={report.projectFormation.ingestionAttributedProjects7d} tone="good" />
            <Stat label="prob. snapshots 24h"   value={report.projectFormation.probabilitySnapshots24h} tone="neutral" />
          </div>
        </Section>

        {/* ── Top jurisdictions ──────────────────────────────────────────── */}
        <Section title="Top jurisdictions / sources (7d)" wide>
          {report.topJurisdictions7d.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>no signals yet</p>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {report.topJurisdictions7d.map((j) => (
                  <tr key={j.jurisdiction} className="border-t border-[var(--line)] first:border-t-0">
                    <td className="py-1">{j.jurisdiction}</td>
                    <td className="py-1 text-right font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>24h {j.signalsLast24h}</td>
                    <td className="py-1 text-right font-mono text-[12px] w-12">{j.signalsLast7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Top emergent signals ───────────────────────────────────────── */}
        <Section title="Top emergent signals (24h)" wide>
          {report.topEmergentSignals24h.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>no high/medium-emergence signals yet</p>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {report.topEmergentSignals24h.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line)] first:border-t-0">
                    <td className="py-1 w-32"><HeuristicBandBadge classification={s.heuristicsClassification} /></td>
                    <td className="py-1 font-mono text-[11px]" style={{ color: "var(--text-dim)" }}>
                      {s.heuristicsScore != null ? s.heuristicsScore.toFixed(2) : "—"}
                    </td>
                    <td className="py-1 font-mono text-[10px] w-32" style={{ color: "#b8ceff" }}>{s.signalSubtype ?? "—"}</td>
                    <td className="py-1 truncate" style={{ color: "var(--text-soft)" }}>{s.headline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Stale sources ──────────────────────────────────────────────── */}
        {report.staleSources.length > 0 && (
          <Section title="Stale / operator-review sources" wide>
            <table className="w-full text-[12px]">
              <tbody>
                {report.staleSources.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line)] first:border-t-0">
                    <td className="py-1" style={{ color: "var(--text-soft)" }}>{s.jurisdiction}</td>
                    <td className="py-1" style={{ color: "var(--text)" }}>{s.name}</td>
                    <td className="py-1 text-right font-mono text-[10px]" style={{ color: "#ffcc72" }}>empty={s.consecutiveEmptyRuns}</td>
                    <td className="py-1 text-right font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{fmtAge(s.lastEmptyRunAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* ── Alert activity (PR8) ────────────────────────────────────────── */}
        <Section title="Alert activity (PR8)" wide>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <Stat label="alerts 24h"   value={report.alertActivity.alertsLast24h} tone="info" />
            <Stat label="alerts 7d"    value={report.alertActivity.alertsLast7d}  tone="info" />
            <Stat label="unread"       value={report.alertActivity.unreadCount}   tone={report.alertActivity.unreadCount > 10 ? "warn" : "neutral"} />
            <Stat label="dismissed 7d" value={report.alertActivity.dismissedCount7d} tone="neutral" />
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
            last alert-eval cycle: {fmtAge(report.alertActivity.lastAlertEvalCycleAt)} (status={report.alertActivity.lastAlertEvalCycleStatus ?? "—"})
            {report.alertActivity.dismissedRatio7d != null && (
              <> · dismissed ratio (7d): {(report.alertActivity.dismissedRatio7d * 100).toFixed(1)}%</>
            )}
          </p>

          {Object.keys(report.alertActivity.unreadBySeverity).length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {(["CRITICAL", "IMPORTANT", "WATCH", "INFO"] as const).map((sev) => (
                <Stat
                  key={sev}
                  label={`unread ${sev}`}
                  value={report.alertActivity.unreadBySeverity[sev] ?? 0}
                  tone={sev === "CRITICAL" ? "warn" : sev === "IMPORTANT" ? "warn" : sev === "WATCH" ? "info" : "neutral"}
                />
              ))}
            </div>
          )}

          {Object.keys(report.alertActivity.byTriggerKind24h).length > 0 && (
            <>
              <p className="font-mono text-[10px] mt-3 mb-1" style={{ color: "var(--text-dim)" }}>alerts by trigger kind (24h)</p>
              <table className="w-full text-[11px]">
                <tbody>
                  {Object.entries(report.alertActivity.byTriggerKind24h).map(([kind, count]) => (
                    <tr key={kind} className="border-t border-[var(--line)] first:border-t-0">
                      <td className="py-1 font-mono text-[10px]" style={{ color: "#b8ceff" }}>{kind}</td>
                      <td className="py-1 text-right font-mono text-[11px]" style={{ color: "var(--text)" }}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {report.alertActivity.topJurisdictions24h.length > 0 && (
            <>
              <p className="font-mono text-[10px] mt-3 mb-1" style={{ color: "var(--text-dim)" }}>top alerting jurisdictions (24h)</p>
              <table className="w-full text-[11px]">
                <tbody>
                  {report.alertActivity.topJurisdictions24h.slice(0, 5).map((j) => (
                    <tr key={j.jurisdiction} className="border-t border-[var(--line)] first:border-t-0">
                      <td className="py-1" style={{ color: "var(--text-soft)" }}>{j.jurisdiction}</td>
                      <td className="py-1 text-right font-mono text-[11px]" style={{ color: "var(--text)" }}>{j.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {report.alertActivity.recentAlerts.length > 0 && (
            <>
              <p className="font-mono text-[10px] mt-3 mb-1" style={{ color: "var(--text-dim)" }}>most recent alerts</p>
              <table className="w-full text-[11px]">
                <tbody>
                  {report.alertActivity.recentAlerts.slice(0, 10).map((al) => (
                    <tr key={al.id} className="border-t border-[var(--line)] first:border-t-0">
                      <td className="py-1 w-20 font-mono text-[9px] uppercase tracking-[0.06em]"
                          style={{ color: al.severity === "CRITICAL" ? "var(--red)" : al.severity === "IMPORTANT" ? "#ffcc72" : al.severity === "WATCH" ? "#b8ceff" : "var(--text-dim)" }}>
                        {al.severity}
                      </td>
                      <td className="py-1 w-32 font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                        {al.runnerTriggerKind ?? "—"}
                      </td>
                      <td className="py-1 truncate" style={{ color: "var(--text)" }}>{al.headline}</td>
                      <td className="py-1 text-right font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{fmtAge(al.capturedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>

        {/* ── Forecast activity (PR7) ─────────────────────────────────────── */}
        <Section title="Forecast activity (PR7)" wide>
          <div className="grid grid-cols-4 gap-2 mb-4">
            <Stat label="snapshots 24h"     value={report.forecastActivity.forecastSnapshotsLast24h} tone="info" />
            <Stat label="snapshots 7d"      value={report.forecastActivity.forecastSnapshotsLast7d}  tone="info" />
            <Stat label="trajectory shifts" value={report.forecastActivity.trajectoryShifts24h}       tone={report.forecastActivity.trajectoryShifts24h > 0 ? "warn" : "neutral"} />
            <Stat label="new HIGH 24h"      value={report.forecastActivity.newHighEmergence24h}      tone={report.forecastActivity.newHighEmergence24h > 0 ? "good" : "neutral"} />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="HIGH projects"     value={report.forecastActivity.highEmergenceProjects} tone="good" />
            <Stat label="HIGH parcels"      value={report.forecastActivity.highEmergenceParcels}  tone="good" />
            <Stat label="overrides (life)"  value={report.forecastActivity.overriddenForecasts}   tone="neutral" />
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
            last forecast-daily cycle: {fmtAge(report.forecastActivity.lastForecastCycleAt)} (status={report.forecastActivity.lastForecastCycleStatus ?? "—"})
          </p>

          {report.forecastActivity.biggestTrajectoryShifts24h.length > 0 && (
            <>
              <p className="font-mono text-[10px] mt-3 mb-1" style={{ color: "var(--text-dim)" }}>biggest 24h trajectory shifts</p>
              <table className="w-full text-[11px]">
                <tbody>
                  {report.forecastActivity.biggestTrajectoryShifts24h.slice(0, 8).map((s) => (
                    <tr key={`${s.subjectKind}-${s.subjectId}`} className="border-t border-[var(--line)] first:border-t-0">
                      <td className="py-1 font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{s.subjectKind}</td>
                      <td className="py-1 font-mono text-[10px] truncate w-40" style={{ color: "var(--text-soft)" }}>{s.subjectId}</td>
                      <td className="py-1 font-mono text-[10px]" style={{ color: "#b8ceff" }}>
                        {s.fromState ? `${s.fromState} → ${s.toState}` : `(new) ${s.toState}`}
                      </td>
                      <td className="py-1 text-right font-mono text-[10px]" style={{ color: s.delta > 0 ? "var(--signal)" : "var(--red)" }}>
                        Δ {s.delta.toFixed(3)}
                      </td>
                      <td className="py-1 font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{s.shiftReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {report.forecastActivity.topEmergenceProjects.length > 0 && (
            <>
              <p className="font-mono text-[10px] mt-3 mb-1" style={{ color: "var(--text-dim)" }}>top HIGH-emergence projects</p>
              <table className="w-full text-[11px]">
                <tbody>
                  {report.forecastActivity.topEmergenceProjects.map((p) => (
                    <tr key={p.projectId} className="border-t border-[var(--line)] first:border-t-0">
                      <td className="py-1 font-mono text-[10px] w-16" style={{ color: "var(--signal)" }}>{p.score.toFixed(3)}</td>
                      <td className="py-1 font-mono text-[10px] w-16" style={{ color: "var(--text-dim)" }}>{p.confidence}</td>
                      <td className="py-1 truncate" style={{ color: "var(--text)" }}>{p.workingTitle ?? p.projectId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────

function Section({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-[var(--radius)] border border-[var(--line)] overflow-hidden ${wide ? "col-span-2" : ""}`}
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      <div className="px-4 py-2.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-[12px] font-[700] tracking-[-0.02em]">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" | "info" | "neutral" }) {
  const color = { good: "var(--signal)", warn: "#ffcc72", info: "#b8ceff", neutral: "var(--text-soft)" }[tone];
  return (
    <div className="px-2 py-1.5 rounded text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line)" }}>
      <p className="text-[18px] font-[700]" style={{ color }}>{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-[0.06em]" style={{ color: "var(--text-dim)" }}>{label}</p>
    </div>
  );
}
