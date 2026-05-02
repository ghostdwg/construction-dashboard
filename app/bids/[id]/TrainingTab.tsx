"use client";

// Phase 5H-2 — Training Register from Spec Intelligence
//
// Reads training requirements extracted from the spec book AI analysis
// (SpecSection.aiExtractions[].training[]). Read-only view — shows what
// the SPEC REQUIRES the contractor to provide, not what has been delivered.
// Pre-award visibility into training burden per trade and audience.
//
// Filter chips: All / Owner / Maintenance / Operations / Emergency
// Search: free-text against csiNumber, csiTitle, topic, requirement
// Trade filter: dropdown to scope to one trade

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type AudienceType = "OWNER" | "MAINTENANCE" | "OPERATIONS" | "EMERGENCY" | "OTHER";

type TrainingRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  audience: AudienceType;
  topic: string | null;
  requirement: string | null;
  duration: string | null;
  timing: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

type TrainingStats = {
  total: number;
  sectionsWithTraining: number;
  byAudience: Record<string, number>;
};

type ApiResponse = {
  trainings: TrainingRow[];
  stats: TrainingStats;
};

// ── Constants ──────────────────────────────────────────────────────────────

const AUDIENCE_LABELS: Record<AudienceType, string> = {
  OWNER: "Owner",
  MAINTENANCE: "Maintenance",
  OPERATIONS: "Operations",
  EMERGENCY: "Emergency",
  OTHER: "Other",
};

const AUDIENCE_STYLES: Record<AudienceType, string> = {
  OWNER: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  MAINTENANCE: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  OPERATIONS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  EMERGENCY: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  OTHER: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MODERATE: "bg-amber-400 text-amber-900",
  LOW: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  INFO: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function matchesSearch(row: TrainingRow, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    row.csiNumber.toLowerCase().includes(lower) ||
    row.csiTitle.toLowerCase().includes(lower) ||
    (row.topic ?? "").toLowerCase().includes(lower) ||
    (row.requirement ?? "").toLowerCase().includes(lower) ||
    (row.tradeName ?? "").toLowerCase().includes(lower)
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TrainingTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<AudienceType | "all">("all");
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState<string>("all");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/bids/${bidId}/training`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiResponse>;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [bidId]);

  if (loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Loading training register…
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {error}
      </div>
    );
  }

  const { trainings, stats } = data!;

  if (trainings.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Training Register
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Training requirements extracted from the spec book AI analysis.
          </p>
        </div>
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No training requirements found.{" "}
            {stats.sectionsWithTraining === 0
              ? "Run AI spec analysis on the Documents tab first."
              : "The analyzed sections contained no training clauses."}
          </p>
        </section>
      </div>
    );
  }

  const uniqueTrades = Array.from(
    new Map(
      trainings
        .filter((t) => t.tradeName)
        .map((t) => [t.tradeId!, t.tradeName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  let visible = trainings;
  if (audienceFilter !== "all") visible = visible.filter((t) => t.audience === audienceFilter);
  if (tradeFilter !== "all") visible = visible.filter((t) => String(t.tradeId) === tradeFilter);
  if (search.trim()) visible = visible.filter((t) => matchesSearch(t, search.trim()));

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Training Register
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
          Training requirements extracted from the spec book. Covers what the
          contractor must provide — not what has been delivered.
        </p>
      </div>

      {/* ── Rollup stats ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Requirements" value={stats.total} />
          <StatCard label="Spec Sections" value={stats.sectionsWithTraining} />
          <StatCard
            label="Owner Training"
            value={stats.byAudience["OWNER"] ?? 0}
            color="blue"
          />
          <StatCard
            label="Maintenance"
            value={stats.byAudience["MAINTENANCE"] ?? 0}
            color="amber"
          />
        </div>
      </section>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "OWNER", "MAINTENANCE", "OPERATIONS", "EMERGENCY", "OTHER"] as const).map(
          (chip) => {
            const label =
              chip === "all" ? "All" : AUDIENCE_LABELS[chip as AudienceType];
            const count =
              chip === "all"
                ? trainings.length
                : (stats.byAudience[chip] ?? 0);
            if (chip !== "all" && count === 0) return null;
            return (
              <button
                key={chip}
                onClick={() => setAudienceFilter(chip)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  audienceFilter === chip
                    ? "bg-amber-600 text-white"
                    : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {label}
                <span className="ml-1.5 opacity-70">({count})</span>
              </button>
            );
          }
        )}

        {uniqueTrades.length > 1 && (
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            className="ml-auto rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">All Trades</option>
            {uniqueTrades.map(([id, name]) => (
              <option key={id} value={String(id)}>
                {name}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          placeholder="Search section, topic, requirement…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 w-52"
        />
      </div>

      {/* ── Table ── */}
      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
          No training requirements match the current filters.
        </p>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-zinc-400 uppercase tracking-wide border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-3 py-2 w-8">Risk</th>
                <th className="px-3 py-2 w-24">Section</th>
                <th className="px-3 py-2">Spec Section</th>
                <th className="px-3 py-2 w-28 hidden md:table-cell">Trade</th>
                <th className="px-3 py-2 w-28">Audience</th>
                <th className="px-3 py-2 w-24 hidden lg:table-cell">Duration</th>
                <th className="px-3 py-2 w-40 hidden lg:table-cell">Timing</th>
                <th className="px-3 py-2">Topic / Requirement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
              {visible.map((t, i) => (
                <tr
                  key={`${t.specSectionId}-${i}`}
                  className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-3 py-2">
                    <SeverityBadge severity={t.severity} />
                  </td>

                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {t.csiNumber}
                  </td>

                  <td className="px-3 py-2">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                      {t.csiTitle}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                    {t.tradeName ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                  </td>

                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        AUDIENCE_STYLES[t.audience]
                      }`}
                    >
                      {AUDIENCE_LABELS[t.audience]}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap hidden lg:table-cell">
                    {t.duration ?? <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>}
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 hidden lg:table-cell">
                    {t.timing ?? <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>}
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {t.topic && (
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">
                        {t.topic}
                        {t.requirement && " — "}
                      </span>
                    )}
                    {t.requirement ?? (!t.topic && <span className="text-zinc-300 dark:text-zinc-600 italic">—</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-400 dark:text-zinc-500">
            {visible.length === trainings.length
              ? `${trainings.length} requirements from ${stats.sectionsWithTraining} spec sections`
              : `Showing ${visible.length} of ${trainings.length} requirements`}
          </div>
        </div>
      )}

      {/* ── Info box ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <strong className="text-zinc-700 dark:text-zinc-300">Audience types:</strong>{" "}
          <strong>Owner</strong> — training for building owner or owner&apos;s representative (operations, emergency procedures).{" "}
          <strong>Maintenance</strong> — training for facility maintenance staff (equipment service, filter schedules, calibration).{" "}
          <strong>Operations</strong> — training for day-to-day building operations staff (BMS, lighting controls, access control).{" "}
          <strong>Emergency</strong> — life-safety training (fire alarm, sprinkler shutdown, evacuation panels).
          Budget for labor and materials. Document with sign-in sheets per Division 01 closeout requirements.
        </p>
      </section>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: "blue" | "amber" | "emerald";
}) {
  const colorClass =
    color === "blue"
      ? "text-blue-600 dark:text-blue-400"
      : color === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : color === "emerald"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-900 dark:text-zinc-100";
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className={`text-2xl font-semibold mt-0.5 ${colorClass}`}>{value}</p>
    </div>
  );
}

// ── Severity Badge ─────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity)
    return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
  const style = SEVERITY_STYLES[severity.toUpperCase()] ?? SEVERITY_STYLES.INFO;
  const short =
    severity === "CRITICAL"
      ? "CRIT"
      : severity === "MODERATE"
        ? "MOD"
        : severity.slice(0, 4).toUpperCase();
  return (
    <span
      className={`inline-block rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide ${style}`}
    >
      {short}
    </span>
  );
}
