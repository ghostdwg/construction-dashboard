"use client";

// Phase 5H-4 — Closeout Checklist from Spec Intelligence
//
// Reads closeout requirements extracted from the spec book AI analysis
// (SpecSection.aiExtractions[].closeout[]). Read-only view — shows what
// the SPEC REQUIRES at project closeout: record drawings, attic stock,
// O&M manuals, keys, certifications, TAB, commissioning, final clean.
// Pre-award visibility into closeout burden per trade.
//
// Filter chips: All / Record Drawings / Attic Stock / Manuals / Keys /
//               Certifications / Balancing / Commissioning / Final Clean
// Search: free-text against csiNumber, csiTitle, description, quantity
// Trade filter: dropdown to scope to one trade

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type CloseoutType =
  | "RECORD_DRAWINGS"
  | "ATTIC_STOCK"
  | "MANUALS"
  | "KEYS"
  | "CERTIFICATIONS"
  | "BALANCING"
  | "COMMISSIONING"
  | "FINAL_CLEAN"
  | "OTHER";

type CloseoutRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  type: CloseoutType;
  description: string | null;
  quantity: string | null;
  timing: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

type CloseoutStats = {
  total: number;
  sectionsWithCloseout: number;
  byType: Record<string, number>;
};

type ApiResponse = {
  items: CloseoutRow[];
  stats: CloseoutStats;
};

// ── Constants ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<CloseoutType, string> = {
  RECORD_DRAWINGS: "Record Drawings",
  ATTIC_STOCK: "Attic Stock",
  MANUALS: "O&M Manuals",
  KEYS: "Keys",
  CERTIFICATIONS: "Certifications",
  BALANCING: "TAB / Balancing",
  COMMISSIONING: "Commissioning",
  FINAL_CLEAN: "Final Clean",
  OTHER: "Other",
};

const TYPE_SHORT_LABELS: Record<CloseoutType, string> = {
  RECORD_DRAWINGS: "Records",
  ATTIC_STOCK: "Attic Stock",
  MANUALS: "O&M Manuals",
  KEYS: "Keys",
  CERTIFICATIONS: "Certs",
  BALANCING: "TAB",
  COMMISSIONING: "Cx",
  FINAL_CLEAN: "Final Clean",
  OTHER: "Other",
};

const TYPE_STYLES: Record<CloseoutType, string> = {
  RECORD_DRAWINGS: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ATTIC_STOCK: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  MANUALS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  KEYS: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  CERTIFICATIONS: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  BALANCING: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  COMMISSIONING: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  FINAL_CLEAN: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  OTHER: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MODERATE: "bg-amber-400 text-amber-900",
  LOW: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  INFO: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

const FILTER_CHIPS: Array<CloseoutType | "all"> = [
  "all",
  "RECORD_DRAWINGS",
  "ATTIC_STOCK",
  "MANUALS",
  "CERTIFICATIONS",
  "BALANCING",
  "COMMISSIONING",
  "KEYS",
  "FINAL_CLEAN",
  "OTHER",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function matchesSearch(row: CloseoutRow, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    row.csiNumber.toLowerCase().includes(lower) ||
    row.csiTitle.toLowerCase().includes(lower) ||
    (row.description ?? "").toLowerCase().includes(lower) ||
    (row.quantity ?? "").toLowerCase().includes(lower) ||
    (row.tradeName ?? "").toLowerCase().includes(lower)
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CloseoutTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<CloseoutType | "all">("all");
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bids/${bidId}/closeout`)
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
        Loading closeout checklist…
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

  const { items, stats } = data!;

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Closeout Checklist
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Closeout deliverables extracted from the spec book AI analysis.
          </p>
        </div>
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No closeout requirements found.{" "}
            {stats.sectionsWithCloseout === 0
              ? "Run AI spec analysis on the Documents tab first."
              : "The analyzed sections contained no closeout clauses."}
          </p>
        </section>
      </div>
    );
  }

  const uniqueTrades = Array.from(
    new Map(
      items
        .filter((item) => item.tradeName)
        .map((item) => [item.tradeId!, item.tradeName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  let visible = items;
  if (typeFilter !== "all") visible = visible.filter((item) => item.type === typeFilter);
  if (tradeFilter !== "all") visible = visible.filter((item) => String(item.tradeId) === tradeFilter);
  if (search.trim()) visible = visible.filter((item) => matchesSearch(item, search.trim()));

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Closeout Checklist
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
          Record drawings, attic stock, O&amp;M manuals, keys, certifications, TAB, commissioning,
          and final clean requirements from the spec book. Use to price closeout labor at bid time.
        </p>
      </div>

      {/* ── Rollup stats ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Items" value={stats.total} />
          <StatCard label="Spec Sections" value={stats.sectionsWithCloseout} />
          <StatCard
            label="Attic Stock"
            value={stats.byType["ATTIC_STOCK"] ?? 0}
            color="amber"
          />
          <StatCard
            label="Commissioning"
            value={stats.byType["COMMISSIONING"] ?? 0}
            color="indigo"
          />
        </div>
      </section>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_CHIPS.map((chip) => {
          const label = chip === "all" ? "All" : TYPE_SHORT_LABELS[chip as CloseoutType];
          const count =
            chip === "all"
              ? items.length
              : (stats.byType[chip] ?? 0);
          if (chip !== "all" && count === 0) return null;
          return (
            <button
              key={chip}
              onClick={() => setTypeFilter(chip)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === chip
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
              <span className="ml-1.5 opacity-70">({count})</span>
            </button>
          );
        })}

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
          placeholder="Search section, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 w-52"
        />
      </div>

      {/* ── Table ── */}
      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
          No closeout items match the current filters.
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
                <th className="px-3 py-2 w-36">Type</th>
                <th className="px-3 py-2 w-28 hidden lg:table-cell">Quantity</th>
                <th className="px-3 py-2 w-40 hidden lg:table-cell">Timing</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
              {visible.map((item, i) => (
                <tr
                  key={`${item.specSectionId}-${i}`}
                  className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-3 py-2">
                    <SeverityBadge severity={item.severity} />
                  </td>

                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {item.csiNumber}
                  </td>

                  <td className="px-3 py-2">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                      {item.csiTitle}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                    {item.tradeName ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                  </td>

                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        TYPE_STYLES[item.type]
                      }`}
                    >
                      {TYPE_SHORT_LABELS[item.type]}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap hidden lg:table-cell">
                    {item.quantity ?? (
                      <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300 hidden lg:table-cell">
                    {item.timing ?? (
                      <span className="text-zinc-300 dark:text-zinc-600 italic">not specified</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {item.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-400 dark:text-zinc-500">
            {visible.length === items.length
              ? `${items.length} items from ${stats.sectionsWithCloseout} spec sections`
              : `Showing ${visible.length} of ${items.length} items`}
          </div>
        </div>
      )}

      {/* ── Info box ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <strong className="text-zinc-700 dark:text-zinc-300">Use at bid time:</strong>{" "}
          <strong>Attic stock</strong> — extra material (10% spare tile, 1 extra door hardware set) must be priced into the bid.{" "}
          <strong>O&amp;M Manuals</strong> — labor to compile per-trade bound sets (typically 1–2 days/trade).{" "}
          <strong>TAB/Balancing</strong> — certified third-party test-and-balance firm; price separately.{" "}
          <strong>Commissioning</strong> — Owner's Cx agent (OPR/BOD); coordinate with MEP subs.{" "}
          <strong>Record Drawings</strong> — redlined as-builts converted to CAD/BIM; confirm responsibility (GC or each sub).{" "}
          Cross-reference with Division 01 (01 77 00 Closeout Procedures, 01 78 00 Closeout Submittals) for project-wide requirements.
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
  color?: "amber" | "indigo" | "blue" | "emerald";
}) {
  const colorClass =
    color === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : color === "indigo"
        ? "text-indigo-600 dark:text-indigo-400"
        : color === "blue"
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
