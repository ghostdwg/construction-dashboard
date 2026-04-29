import { prisma } from "@/lib/prisma";
import Link from "next/link";
import NewLeadButton from "./NewLeadButton";
import ScanPanel from "./ScanPanel";
import SourcesPanel from "./SourcesPanel";

// ── Status + type chip maps ──────────────────────────────────────────────────

const LEAD_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  NEW:       { label: "NEW",       color: "var(--text-soft)",  bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.12)"  },
  REVIEWING: { label: "REVIEWING", color: "#ffcc72",           bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)"   },
  QUALIFIED: { label: "QUALIFIED", color: "#b8ceff",           bg: "rgba(126,167,255,0.1)",  border: "rgba(126,167,255,0.2)"  },
  PURSUING:  { label: "PURSUING",  color: "var(--signal-soft)",bg: "var(--signal-dim)",      border: "rgba(0,255,100,0.22)"   },
  ARCHIVED:  { label: "ARCHIVED",  color: "var(--text-dim)",   bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.07)" },
  DISMISSED: { label: "DISMISSED", color: "var(--text-dim)",   bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.07)" },
};

const LEAD_TYPE_LABEL: Record<string, string> = {
  PERMIT:          "Permit",
  MEETING_MINUTE:  "Mtg Minute",
  PLAN_ROOM:       "Plan Room",
  LAND_ACQUISITION:"Land Acq",
  BROKER:          "Broker",
  RELATIONSHIP:    "Relationship",
  MANUAL:          "Manual",
};

const SIGNAL_TYPE: Record<string, { label: string; color: string }> = {
  PERMIT:            { label: "PERMIT",       color: "#b8ceff" },
  MEETING_MINUTE:    { label: "MTG MINUTE",   color: "#ffcc72" },
  PLAN_ROOM_JOB:     { label: "PLAN ROOM",    color: "var(--signal-soft)" },
  PLAN_ROOM_VIEW:    { label: "PLAN VIEW",    color: "var(--text-dim)" },
  LAND_ACQUISITION:  { label: "LAND ACQ",     color: "#ffcc72" },
  BROKER_LISTING:    { label: "BROKER",       color: "#b8ceff" },
  ARCHITECT_PROJECT: { label: "ARCHITECT",    color: "#b8ceff" },
  MANUAL:            { label: "MANUAL",       color: "var(--text-dim)" },
};

const REL_TYPE_LABEL: Record<string, string> = {
  DESIGNED:   "Designed",
  BUILT:      "Built",
  PARTNERED:  "Partnered",
  COMPETING:  "Competing",
  OWNED:      "Owned",
};

// ── Helper formatters ────────────────────────────────────────────────────────

function fmtValue(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function fmtAge(d: Date): string {
  const hours = Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000);
  if (hours < 1)  return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PanelHead({ title, count }: { title: string; count?: number }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <p className="text-sm font-[700] tracking-[-0.02em]">{title}</p>
      {count !== undefined && (
        <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{count}</span>
      )}
    </div>
  );
}

function MetricCard({
  label, value, sub, accent,
}: {
  label: string; value: string | number; sub: string;
  accent: "signal" | "amber" | "blue" | "red";
}) {
  const color = { signal: "var(--signal)", amber: "var(--amber)", blue: "var(--blue)", red: "var(--red)" }[accent];
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--line)] px-4 py-4"
      style={{ background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))", boxShadow: "var(--shadow)" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: color }} />
      <p className="font-mono text-[10px] uppercase tracking-[0.09em] mb-2" style={{ color: "var(--text-dim)" }}>{label}</p>
      <p className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>{value}</p>
      <p className="text-xs mt-2" style={{ color: "var(--text-soft)" }}>{sub}</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function MarketIntelligencePage() {
  const oneDayAgo = new Date(Date.now() - 86_400_000);

  const [
    unassignedSignals,
    activeLeads,
    relationships,
    newSignalCount,
    qualifiedCount,
    pursuingCount,
    totalLeads,
  ] = await Promise.all([
    prisma.marketSignal.findMany({
      where:   { leadId: null },
      orderBy: [{ aiRelevanceScore: "desc" }, { createdAt: "desc" }],
      take:    25,
    }),
    prisma.marketLead.findMany({
      where:   { status: { notIn: ["ARCHIVED", "DISMISSED"] } },
      orderBy: { detectedAt: "desc" },
      include: { signals: { select: { id: true } } },
    }),
    prisma.relationshipEdge.findMany({
      orderBy: { createdAt: "desc" },
      take:    8,
    }),
    prisma.marketSignal.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.marketLead.count({ where: { status: "QUALIFIED" } }),
    prisma.marketLead.count({ where: { status: "PURSUING" } }),
    prisma.marketLead.count({ where: { status: { notIn: ["ARCHIVED", "DISMISSED"] } } }),
  ]);

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // market intelligence
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Market Intelligence
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            Signal ingestion · permit feeds · relationship intel · pursuit pipeline
          </p>
        </div>
        <div className="flex items-center gap-2 relative">
          <ScanPanel />
          <NewLeadButton />
        </div>
      </div>

      {/* ── Metric cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 p-6 pb-0">
        <MetricCard accent="blue"   label="New Signals 24H"   value={newSignalCount} sub="unreviewed signals" />
        <MetricCard accent="signal" label="Active Pipeline"   value={totalLeads}     sub="leads in review" />
        <MetricCard accent="blue"   label="Qualified"         value={qualifiedCount} sub="ready to evaluate" />
        <MetricCard accent="signal" label="In Pursuit"        value={pursuingCount}  sub="promoted to active" />
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-5 p-6">

        {/* ── Left column ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-5">

          {/* Scrape Sources */}
          <SourcesPanel />

          {/* Signal Queue */}
          <div
            className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <PanelHead title="Unassigned Signals" count={unassignedSignals.length} />
            {unassignedSignals.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-[500]" style={{ color: "var(--signal-soft)" }}>Signal queue clear</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
                  Signals appear here when scrapers run or when you add one manually.
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Type", "Headline", "Source", "Date", "Score", ""].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)]"
                        style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unassignedSignals.map((sig) => {
                    const st = SIGNAL_TYPE[sig.signalType] ?? { label: sig.signalType, color: "var(--text-dim)" };
                    return (
                      <tr key={sig.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                        <td className="px-4 py-3">
                          <span
                            className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ color: st.color, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[13px] font-[500]" style={{ color: "var(--text)" }}>
                          {sig.headline}
                        </td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {sig.source ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {fmtDate(sig.sourceDate)}
                        </td>
                        <td className="px-4 py-3">
                          {sig.aiRelevanceScore != null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${sig.aiRelevanceScore}%`,
                                    background: sig.aiRelevanceScore >= 70 ? "var(--signal)" : sig.aiRelevanceScore >= 40 ? "var(--amber)" : "var(--red)",
                                  }}
                                />
                              </div>
                              <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                                {sig.aiRelevanceScore}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-dim)" }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                            {fmtAge(sig.createdAt)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Lead Pipeline */}
          <div
            className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <PanelHead title="Lead Pipeline" count={activeLeads.length} />
            {activeLeads.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-dim)" }}>
                No active leads yet. Add one manually or run a market scraper.
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Project", "Type", "Location", "Est. Value", "Signals", "Status", "Detected", ""].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)]"
                        style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeLeads.map((lead) => {
                    const chip = LEAD_STATUS[lead.status] ?? LEAD_STATUS.NEW;
                    return (
                      <tr key={lead.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-[600]" style={{ color: "var(--text)" }}>{lead.title}</p>
                          {lead.jurisdiction && (
                            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>{lead.jurisdiction}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {LEAD_TYPE_LABEL[lead.leadType] ?? lead.leadType}
                        </td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {lead.location ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-[13px] font-[600]" style={{ color: "var(--text)" }}>
                          {fmtValue(lead.estimatedValue)}
                        </td>
                        <td className="px-4 py-3 text-[13px] font-[600]" style={{ color: "var(--text-dim)" }}>
                          {lead.signals.length}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center px-2 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] whitespace-nowrap"
                            style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
                          >
                            {chip.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                          {fmtDate(lead.detectedAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/market-intelligence/${lead.id}`}
                            className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors"
                            style={{ border: "1px solid var(--line)" }}
                          >
                            Review →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <div
          className="w-[300px] shrink-0 flex flex-col gap-4"
          style={{ position: "sticky", top: 0, height: "calc(100vh - 62px)", overflowY: "auto" }}
        >
          {/* Pipeline Health */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">Pipeline Health</p>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {(["NEW","REVIEWING","QUALIFIED","PURSUING"] as const).map((s) => {
                const chip = LEAD_STATUS[s];
                const cnt = activeLeads.filter((l) => l.status === s).length;
                return (
                  <div key={s} className="flex items-center justify-between">
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded-full"
                      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
                    >
                      {chip.label}
                    </span>
                    <span className="font-mono text-[12px]" style={{ color: "var(--text)" }}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Relationship Intel */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">Relationship Intel</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>GC · Architect · Owner graph</p>
            </div>
            {relationships.length === 0 ? (
              <div className="px-4 py-6 text-center text-[11px]" style={{ color: "var(--text-dim)" }}>
                No relationships mapped yet. Detected automatically from permit and plan room data.
              </div>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {relationships.map((rel) => (
                  <div key={rel.id} className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12px] font-[600]" style={{ color: "var(--text)" }}>{rel.fromName}</span>
                      <span className="font-mono text-[9px] uppercase" style={{ color: "var(--text-dim)" }}>
                        {REL_TYPE_LABEL[rel.relationshipType] ?? rel.relationshipType}
                      </span>
                      <span className="text-[12px] font-[600]" style={{ color: "var(--text-soft)" }}>{rel.toName}</span>
                    </div>
                    {rel.projectName && (
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-dim)" }}>{rel.projectName}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {rel.projectValue && (
                        <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{fmtValue(rel.projectValue)}</span>
                      )}
                      {rel.projectYear && (
                        <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{rel.projectYear}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scraper Status */}
          <div
            className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
          >
            <div className="px-4 py-3.5 border-b border-[var(--line)]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-sm font-[700] tracking-[-0.02em]">Ingestion Sources</p>
            </div>
            <div className="p-4 flex flex-col gap-2.5">
              {[
                { label: "Beeline / Blue Plan Room", status: "Planned" },
                { label: "City Hall Meeting Minutes", status: "Planned" },
                { label: "County Permit Feeds",       status: "Planned" },
                { label: "Land Acquisition Records",  status: "Planned" },
                { label: "Broker Listings",           status: "Planned" },
                { label: "Architect Project History", status: "Planned" },
              ].map(({ label, status }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: "var(--text-soft)" }}>{label}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.06em]" style={{ color: "var(--text-dim)" }}>{status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
