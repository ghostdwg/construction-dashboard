"use client";

// Phase 5H (near-term) — Warranty Register from Spec Intelligence
//
// Reads warranty requirements extracted from the spec book AI analysis
// (SpecSection.aiExtractions[].warranty[]). Read-only view — shows what
// the SPEC REQUIRES, not what's been received. Gives estimators pre-award
// visibility into warranty burden per trade and section.
//
// Filter chips: All / Manufacturer / Installer / System
// Search: free-text against csiNumber, csiTitle, scope, duration
// Trade filter: dropdown to scope to one trade

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type WarrantyType = "MANUFACTURER" | "INSTALLER" | "SYSTEM" | "OTHER";

type WarrantyRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  duration: string | null;
  type: WarrantyType;
  scope: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

type WarrantyStats = {
  total: number;
  sectionsWithWarranties: number;
  byType: Record<string, number>;
};

type ApiResponse = {
  warranties: WarrantyRow[];
  stats: WarrantyStats;
};

// ── Constants ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<WarrantyType, string> = {
  MANUFACTURER: "Manufacturer",
  INSTALLER: "Installer",
  SYSTEM: "System",
  OTHER: "Other",
};

const TYPE_STYLES: Record<WarrantyType, string> = {
  MANUFACTURER: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  INSTALLER: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  SYSTEM: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
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

function matchesSearch(row: WarrantyRow, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    row.csiNumber.toLowerCase().includes(lower) ||
    row.csiTitle.toLowerCase().includes(lower) ||
    (row.scope ?? "").toLowerCase().includes(lower) ||
    (row.duration ?? "").toLowerCase().includes(lower) ||
    (row.tradeName ?? "").toLowerCase().includes(lower)
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function WarrantiesTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<WarrantyType | "all">("all");
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bids/${bidId}/warranties`)
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
        Loading warranty register…
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

  const { warranties, stats } = data!;

  // No spec analysis yet
  if (warranties.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Warranty Register
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Warranty requirements extracted from the spec book AI analysis.
          </p>
        </div>
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No warranty requirements found.{" "}
            {stats.sectionsWithWarranties === 0
              ? "Run AI spec analysis on the Documents tab first."
              : "The analyzed sections contained no warranty clauses."}
          </p>
        </section>
      </div>
    );
  }

  // Collect unique trades for the trade filter dropdown
  const uniqueTrades = Array.from(
    new Map(
      warranties
        .filter((w) => w.tradeName)
        .map((w) => [w.tradeId!, w.tradeName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Apply filters
  let visible = warranties;
  if (typeFilter !== "all") visible = visible.filter((w) => w.type === typeFilter);
  if (tradeFilter !== "all") visible = visible.filter((w) => String(w.tradeId) === tradeFilter);
  if (search.trim()) visible = visible.filter((w) => matchesSearch(w, search.trim()));

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Warranty Register
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
          Warranty requirements extracted from the spec book. Covers what the
          spec requires — not what has been received.
        </p>
      </div>

      {/* ── Rollup stats ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Requirements" value={stats.total} />
          <StatCard label="Spec Sections" value={stats.sectionsWithWarranties} />
          <StatCard
            label="Manufacturer"
            value={stats.byType["MANUFACTURER"] ?? 0}
            color="blue"
          />
          <StatCard
            label="Installer"
            value={stats.byType["INSTALLER"] ?? 0}
            color="emerald"
          />
        </div>
      </section>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Type chips */}
        {(["all", "MANUFACTURER", "INSTALLER", "SYSTEM", "OTHER"] as const).map(
          (chip) => {
            const label =
              chip === "all" ? "All" : TYPE_LABELS[chip as WarrantyType];
            const count =
              chip === "all"
                ? warranties.length
                : (stats.byType[chip] ?? 0);
            if (chip !== "all" && count === 0) return null;
            return (
              <button
                key={chip}
                onClick={() => setTypeFilter(chip)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  typeFilter === chip
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

        {/* Trade dropdown */}
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

        {/* Search */}
        <input
          type="search"
          placeholder="Search section, scope, duration…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 w-52"
        />
      </div>

      {/* ── Table ── */}
      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
          No warranties match the current filters.
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
                <th className="px-3 py-2 w-28">Type</th>
                <th className="px-3 py-2 w-24">Duration</th>
                <th className="px-3 py-2">Scope / Requirement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
              {visible.map((w, i) => (
                <tr
                  key={`${w.specSectionId}-${i}`}
                  className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
                >
                  {/* Risk / severity */}
                  <td className="px-3 py-2">
                    <SeverityBadge severity={w.severity} />
                  </td>

                  {/* CSI number */}
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {w.csiNumber}
                  </td>

                  {/* Title */}
                  <td className="px-3 py-2">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                      {w.csiTitle}
                    </span>
                  </td>

                  {/* Trade */}
                  <td className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                    {w.tradeName ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                  </td>

                  {/* Type badge */}
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        TYPE_STYLES[w.type]
                      }`}
                    >
                      {TYPE_LABELS[w.type]}
                    </span>
                  </td>

                  {/* Duration */}
                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                    {w.duration ?? <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>}
                  </td>

                  {/* Scope */}
                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {w.scope ?? <span className="text-zinc-300 dark:text-zinc-600 italic">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-400 dark:text-zinc-500">
            {visible.length === warranties.length
              ? `${warranties.length} requirements from ${stats.sectionsWithWarranties} spec sections`
              : `Showing ${visible.length} of ${warranties.length} requirements`}
          </div>
        </div>
      )}

      {/* ── Info box ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <strong className="text-zinc-700 dark:text-zinc-300">Warranty types:</strong>{" "}
          <strong>Manufacturer</strong> — product warranty provided by the factory
          (materials, defects).{" "}
          <strong>Installer</strong> — workmanship warranty provided by the subcontractor.{" "}
          <strong>System</strong> — performance warranty covering integrated systems
          (roof system, curtain wall, MEP commissioning).
          Durations and scope reflect what the specification requires — verify
          against Division 01 submittal procedures and AIA A201 §12.2.
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
  color?: "blue" | "emerald";
}) {
  const colorClass =
    color === "blue"
      ? "text-blue-600 dark:text-blue-400"
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
