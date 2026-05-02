"use client";

// Phase 5H-3 — Inspections Register from Spec Intelligence
//
// Reads inspection requirements extracted from the spec book AI analysis
// (SpecSection.aiExtractions[].inspections[]). Read-only view — shows what
// the SPEC REQUIRES in terms of field QC, special inspections, and testing.
// Pre-award visibility into inspection burden per trade.
//
// Filter chips: All / Special / Third-Party / Owner Witness / Contractor QC / AHJ
// Search: free-text against csiNumber, csiTitle, activity, standard, who
// Trade filter: dropdown to scope to one trade

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type InspectionType =
  | "SPECIAL"
  | "THIRD_PARTY"
  | "OWNER_WITNESS"
  | "CONTRACTOR_QC"
  | "AHJ"
  | "OTHER";

type InspectionRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  type: InspectionType;
  activity: string | null;
  standard: string | null;
  frequency: string | null;
  timing: string | null;
  who: string | null;
  acceptanceCriteria: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

type InspectionStats = {
  total: number;
  sectionsWithInspections: number;
  byType: Record<string, number>;
};

type ApiResponse = {
  inspections: InspectionRow[];
  stats: InspectionStats;
};

// ── Constants ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<InspectionType, string> = {
  SPECIAL: "Special",
  THIRD_PARTY: "3rd Party",
  OWNER_WITNESS: "Owner Witness",
  CONTRACTOR_QC: "Contractor QC",
  AHJ: "AHJ",
  OTHER: "Other",
};

const TYPE_STYLES: Record<InspectionType, string> = {
  SPECIAL: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  THIRD_PARTY: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  OWNER_WITNESS: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  CONTRACTOR_QC: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  AHJ: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  OTHER: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MODERATE: "bg-amber-400 text-amber-900",
  LOW: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  INFO: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function matchesSearch(row: InspectionRow, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    row.csiNumber.toLowerCase().includes(lower) ||
    row.csiTitle.toLowerCase().includes(lower) ||
    (row.activity ?? "").toLowerCase().includes(lower) ||
    (row.standard ?? "").toLowerCase().includes(lower) ||
    (row.who ?? "").toLowerCase().includes(lower) ||
    (row.tradeName ?? "").toLowerCase().includes(lower)
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function InspectionsTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<InspectionType | "all">("all");
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState<string>("all");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/bids/${bidId}/inspections`)
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
        Loading inspections register…
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

  const { inspections, stats } = data!;

  if (inspections.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Inspections Register
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Special inspections and field QC requirements extracted from the spec book AI analysis.
          </p>
        </div>
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No inspection requirements found.{" "}
            {stats.sectionsWithInspections === 0
              ? "Run AI spec analysis on the Documents tab first."
              : "The analyzed sections contained no inspection clauses."}
          </p>
        </section>
      </div>
    );
  }

  const uniqueTrades = Array.from(
    new Map(
      inspections
        .filter((i) => i.tradeName)
        .map((i) => [i.tradeId!, i.tradeName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  let visible = inspections;
  if (typeFilter !== "all") visible = visible.filter((i) => i.type === typeFilter);
  if (tradeFilter !== "all") visible = visible.filter((i) => String(i.tradeId) === tradeFilter);
  if (search.trim()) visible = visible.filter((i) => matchesSearch(i, search.trim()));

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Inspections Register
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
          Special inspections, third-party testing, and field QC requirements from the spec book.
          Covers what the spec requires — not what has been scheduled.
        </p>
      </div>

      {/* ── Rollup stats ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Requirements" value={stats.total} />
          <StatCard label="Spec Sections" value={stats.sectionsWithInspections} />
          <StatCard
            label="Special Inspections"
            value={stats.byType["SPECIAL"] ?? 0}
            color="red"
          />
          <StatCard
            label="Third-Party Testing"
            value={stats.byType["THIRD_PARTY"] ?? 0}
            color="blue"
          />
        </div>
      </section>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "SPECIAL", "THIRD_PARTY", "OWNER_WITNESS", "CONTRACTOR_QC", "AHJ", "OTHER"] as const).map(
          (chip) => {
            const label = chip === "all" ? "All" : TYPE_LABELS[chip as InspectionType];
            const count =
              chip === "all"
                ? inspections.length
                : (stats.byType[chip] ?? 0);
            if (chip !== "all" && count === 0) return null;
            return (
              <button
                key={chip}
                onClick={() => setTypeFilter(chip)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  typeFilter === chip
                    ? "bg-blue-600 text-white"
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
          placeholder="Search section, activity, standard…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 w-52"
        />
      </div>

      {/* ── Table ── */}
      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
          No inspections match the current filters.
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
                <th className="px-3 py-2 w-32">Type</th>
                <th className="px-3 py-2 w-36 hidden lg:table-cell">Who</th>
                <th className="px-3 py-2 w-24 hidden lg:table-cell">Frequency</th>
                <th className="px-3 py-2">Activity / Standard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
              {visible.map((insp, i) => (
                <tr
                  key={`${insp.specSectionId}-${i}`}
                  className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-3 py-2">
                    <SeverityBadge severity={insp.severity} />
                  </td>

                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {insp.csiNumber}
                  </td>

                  <td className="px-3 py-2">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                      {insp.csiTitle}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                    {insp.tradeName ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                  </td>

                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        TYPE_STYLES[insp.type]
                      }`}
                    >
                      {TYPE_LABELS[insp.type]}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 hidden lg:table-cell">
                    {insp.who ?? (
                      <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap hidden lg:table-cell">
                    {insp.frequency ?? (
                      <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {insp.activity && (
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">
                        {insp.activity}
                      </span>
                    )}
                    {insp.standard && (
                      <span className="ml-1 text-zinc-400 dark:text-zinc-500">
                        — {insp.standard}
                      </span>
                    )}
                    {insp.acceptanceCriteria && (
                      <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                        {insp.acceptanceCriteria}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-400 dark:text-zinc-500">
            {visible.length === inspections.length
              ? `${inspections.length} requirements from ${stats.sectionsWithInspections} spec sections`
              : `Showing ${visible.length} of ${inspections.length} requirements`}
          </div>
        </div>
      )}

      {/* ── Info box ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <strong className="text-zinc-700 dark:text-zinc-300">Inspection types:</strong>{" "}
          <strong>Special</strong> — IBC Chapter 17 special inspections (concrete, masonry, steel, soils) — require a certified special inspector hired by the owner.{" "}
          <strong>Third-Party</strong> — independent testing lab for material certifications, mix designs, or performance verification.{" "}
          <strong>Owner Witness</strong> — owner or A/E must be present before work can be covered.{" "}
          <strong>AHJ</strong> — Authority Having Jurisdiction inspections (building department, fire marshal).{" "}
          Budget for testing lab fees, inspector labor, and re-inspection allowances. Coordinate with the Special Inspection Agreement (if required by the IBC).
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
  color?: "red" | "blue" | "amber" | "emerald";
}) {
  const colorClass =
    color === "red"
      ? "text-red-600 dark:text-red-400"
      : color === "blue"
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


