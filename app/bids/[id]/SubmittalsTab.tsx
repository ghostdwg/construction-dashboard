"use client";

// Module H3 — Submittal Register UI
//
// Rendered as a new tab "Submittals" on the bid detail page (position 11).
// Features:
//   - Rollup card (total, by status, overdue)
//   - Filters (status, type)
//   - Seed from specs button (runs regex extraction)
//   - Manually add submittal form
//   - Inline-editable row status dropdown
//   - Expand row → full detail edit
//   - Export to Procore CSV
//   - Delete row

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

const SUBMITTAL_TYPES = [
  "PRODUCT_DATA",
  "SHOP_DRAWING",
  "SAMPLE",
  "MOCKUP",
  "WARRANTY",
  "O_AND_M",
  "LEED",
  "CERT",
  "OTHER",
] as const;
type SubmittalType = (typeof SUBMITTAL_TYPES)[number];

const SUBMITTAL_STATUSES = [
  "PENDING",
  "REQUESTED",
  "RECEIVED",
  "UNDER_REVIEW",
  "APPROVED",
  "APPROVED_AS_NOTED",
  "REJECTED",
  "RESUBMIT",
] as const;
type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];

const TYPE_LABELS: Record<SubmittalType, string> = {
  PRODUCT_DATA: "Product Data",
  SHOP_DRAWING: "Shop Drawings",
  SAMPLE: "Sample",
  MOCKUP: "Mock-Up",
  WARRANTY: "Warranty",
  O_AND_M: "O&M Manual",
  LEED: "LEED Doc",
  CERT: "Certificate",
  OTHER: "Other",
};

const STATUS_LABELS: Record<SubmittalStatus, string> = {
  PENDING: "Pending",
  REQUESTED: "Requested",
  RECEIVED: "Received",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  APPROVED_AS_NOTED: "Approved as Noted",
  REJECTED: "Rejected",
  RESUBMIT: "Resubmit",
};

const STATUS_STYLES: Record<SubmittalStatus, string> = {
  PENDING:           "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  REQUESTED:         "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  RECEIVED:          "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  UNDER_REVIEW:      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED:          "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  APPROVED_AS_NOTED: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
  REJECTED:          "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  RESUBMIT:          "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

type SubmittalRow = {
  id: number;
  bidTradeId: number | null;
  tradeName: string | null;
  tradeCsiCode: string | null;
  specSectionId: number | null;
  specSectionNumber: string | null;
  submittalNumber: string | null;
  title: string;
  description: string | null;
  type: SubmittalType;
  status: SubmittalStatus;
  requiredBy: string | null;
  requestedAt: string | null;
  receivedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  responsibleSubId: number | null;
  responsibleSubName: string | null;
  reviewer: string | null;
  notes: string | null;
  isOverdue: boolean;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "INFO" | null;
};

type Rollup = {
  total: number;
  byStatus: Record<SubmittalStatus, number>;
  byType: Record<SubmittalType, number>;
  overdue: number;
};

type GenerateFromAiResult = {
  sectionsScanned: number;
  sectionsWithExtractions: number;
  submittalsFound: number;
  created: number;
  skipped: number;
  skippedBoilerplate: number;
  skippedProcedural: number;
  deferredToCloseout: number;
  bidTradesLinked: number;
  previousAutoItemsRemoved: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SubmittalsTab({ bidId }: { bidId: number }) {
  const [items, setItems] = useState<SubmittalRow[] | null>(null);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // View group — client-side filter across type categories
  type ViewGroup = "all" | "active" | "closeout";
  const [view, setView] = useState<ViewGroup>("all");

  const VIEW_TYPES: Record<ViewGroup, SubmittalType[] | null> = {
    all: null,
    active: ["PRODUCT_DATA", "SHOP_DRAWING", "SAMPLE", "MOCKUP", "OTHER"],
    closeout: ["WARRANTY", "O_AND_M"],
  };

  const [generatingFromAi, setGeneratingFromAi] = useState(false);
  const [aiBanner, setAiBanner] = useState<GenerateFromAiResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (typeFilter) params.set("type", typeFilter);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/bids/${bidId}/submittals${qs}`, { signal: controller.signal });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { items: SubmittalRow[]; rollup: Rollup };
        if (cancelled) return;
        setItems(data.items);
        setRollup(data.rollup);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bidId, statusFilter, typeFilter, reloadTick]);

  async function runGenerateFromAi() {
    setGeneratingFromAi(true);
    setAiBanner(null);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/generate-from-specs`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as GenerateFromAiResult;
      setAiBanner(data);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingFromAi(false);
    }
  }

  async function runExport() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/export`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Export failed: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : "submittals.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function updateStatus(id: number, status: SubmittalStatus) {
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteItem(id: number) {
    if (!confirm("Delete this submittal?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading submittal register…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header + Actions ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Submittal Register
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Track submittals through the full lifecycle. Seed from spec book, then manage manually.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={runGenerateFromAi}
            disabled={generatingFromAi}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            title="Regenerates the register from AI Spec Analysis. Replaces all auto-generated items; manual entries are preserved."
          >
            {generatingFromAi ? "Generating…" : "Generate from AI Analysis"}
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {showAddForm ? "Cancel Add" : "+ Add Submittal"}
          </button>
          <button
            onClick={runExport}
            disabled={exporting || !items || items.length === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export Procore CSV"}
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── AI generation result banner ── */}
      {aiBanner && (
        <div className="rounded-md border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-700 dark:border-purple-900 dark:bg-purple-900/30 dark:text-purple-300">
          AI analysis read {aiBanner.sectionsWithExtractions} sections, found{" "}
          <strong>{aiBanner.submittalsFound}</strong> requirements.
          {aiBanner.previousAutoItemsRemoved > 0 && ` Replaced ${aiBanner.previousAutoItemsRemoved} prior auto-generated items.`}
          {" "}Created <strong>{aiBanner.created}</strong> items
          {aiBanner.skippedProcedural > 0 && `, skipped ${aiBanner.skippedProcedural} Div 00/01 (procedural)`}
          {aiBanner.skippedBoilerplate > 0 && `, skipped ${aiBanner.skippedBoilerplate} generic boilerplate`}
          {aiBanner.deferredToCloseout > 0 && `, deferred ${aiBanner.deferredToCloseout} warranty/O&M/LEED to closeout register`}
          {aiBanner.bidTradesLinked > 0 && ` · ${aiBanner.bidTradesLinked} auto-linked to bid trades`}.
        </div>
      )}

      {/* ── Rollup card ── */}
      {rollup && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <RollupStat label="Total" value={rollup.total} />
            <RollupStat label="Pending" value={rollup.byStatus.PENDING + rollup.byStatus.REQUESTED} />
            <RollupStat label="In Review" value={rollup.byStatus.RECEIVED + rollup.byStatus.UNDER_REVIEW} />
            <RollupStat
              label="Approved"
              value={rollup.byStatus.APPROVED + rollup.byStatus.APPROVED_AS_NOTED}
            />
            <RollupStat label="Overdue" value={rollup.overdue} tone={rollup.overdue > 0 ? "warn" : undefined} />
          </div>
        </section>
      )}

      {/* ── Add form ── */}
      {showAddForm && (
        <AddSubmittalForm
          bidId={bidId}
          onCreated={() => {
            setShowAddForm(false);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {/* ── View chips (group by type) ── */}
      <div className="flex gap-2 items-center flex-wrap">
        {([
          ["all", "All"],
          ["active", "Active Review"],
          ["closeout", "Closeout"],
        ] as const).map(([key, label]) => {
          const isActive = view === key;
          const count = (() => {
            if (!items) return null;
            const types = VIEW_TYPES[key as ViewGroup];
            return types === null
              ? items.length
              : items.filter((i) => types.includes(i.type as SubmittalType)).length;
          })();
          return (
            <button
              key={key}
              onClick={() => setView(key as ViewGroup)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-purple-600 text-white"
                  : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
              {count !== null && <span className="ml-1.5 opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-3 items-center flex-wrap">
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">All</option>
            {SUBMITTAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="font-medium">Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">All</option>
            {SUBMITTAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {(statusFilter || typeFilter) && (
          <button
            onClick={() => {
              setStatusFilter("");
              setTypeFilter("");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Table ── */}
      {(() => {
        const allowedTypes = VIEW_TYPES[view];
        const viewFiltered = items
          ? allowedTypes === null
            ? items
            : items.filter((i) => allowedTypes.includes(i.type as SubmittalType))
          : null;
        return viewFiltered && viewFiltered.length === 0 ? (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {statusFilter || typeFilter || view !== "all"
              ? "No submittals match the current filter."
              : "No submittals yet. Click \"Generate from AI Analysis\" to extract them, or add one manually."}
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2.5 w-20">Risk</th>
                <th className="px-4 py-2.5 w-28">Number</th>
                <th className="px-4 py-2.5">Title</th>
                <th className="px-4 py-2.5 w-28">Type</th>
                <th className="px-4 py-2.5 w-36">Responsible</th>
                <th className="px-4 py-2.5 w-28">Required By</th>
                <th className="px-4 py-2.5 w-40">Status</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {viewFiltered?.map((item) => (
                <SubmittalTableRow
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onStatusChange={(s) => updateStatus(item.id, s)}
                  onDelete={() => deleteItem(item.id)}
                  onEdited={() => setReloadTick((t) => t + 1)}
                  bidId={bidId}
                />
              ))}
            </tbody>
          </table>
        </section>
      );
      })()}
    </div>
  );
}

// ── Severity Badge ─────────────────────────────────────────────────────────

function SeverityBadge({
  severity,
}: {
  severity: SubmittalRow["severity"];
}) {
  if (!severity) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>;
  }
  const styles: Record<NonNullable<SubmittalRow["severity"]>, string> = {
    CRITICAL: "bg-red-600 text-white",
    HIGH: "bg-orange-500 text-white",
    MODERATE: "bg-amber-400 text-amber-900",
    LOW: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    INFO: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  };
  const labels: Record<NonNullable<SubmittalRow["severity"]>, string> = {
    CRITICAL: "CRIT",
    HIGH: "HIGH",
    MODERATE: "MOD",
    LOW: "LOW",
    INFO: "INFO",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${styles[severity]}`}
      title={`Risk: ${severity}`}
    >
      {labels[severity]}
    </span>
  );
}

// ── Rollup Stat ────────────────────────────────────────────────────────────

function RollupStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  const color =
    tone === "warn"
      ? "text-red-600 dark:text-red-400"
      : "text-zinc-900 dark:text-zinc-100";
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────

function SubmittalTableRow({
  item,
  expanded,
  onToggleExpand,
  onStatusChange,
  onDelete,
  onEdited,
  bidId,
}: {
  item: SubmittalRow;
  expanded: boolean;
  onToggleExpand: () => void;
  onStatusChange: (s: SubmittalStatus) => void;
  onDelete: () => void;
  onEdited: () => void;
  bidId: number;
}) {
  const isOverdue = item.isOverdue;

  return (
    <>
      <tr className={isOverdue ? "bg-red-50/40 dark:bg-red-900/10" : ""}>
        <td className="px-4 py-2.5">
          <SeverityBadge severity={item.severity} />
        </td>
        <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
          {item.submittalNumber ?? "—"}
        </td>
        <td className="px-4 py-2.5">
          <div className="font-medium text-zinc-800 dark:text-zinc-100">{item.title}</div>
          {item.specSectionNumber && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              Spec {item.specSectionNumber}
            </div>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
          <span>{TYPE_LABELS[item.type]}</span>
          {(item.type === "WARRANTY" || item.type === "O_AND_M") && (
            <span className="ml-1.5 inline-block rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              CLOSEOUT
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
          {item.responsibleSubName ?? (
            <span className="text-zinc-400 italic dark:text-zinc-500">unassigned</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
          <span className={isOverdue ? "text-red-600 dark:text-red-400 font-semibold" : ""}>
            {fmtDate(item.requiredBy)}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <select
            value={item.status}
            onChange={(e) => onStatusChange(e.target.value as SubmittalStatus)}
            className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 ${STATUS_STYLES[item.status]}`}
          >
            {SUBMITTAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-2.5 text-right">
          <button
            onClick={onToggleExpand}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {expanded ? "▲" : "▼"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-zinc-50 dark:bg-zinc-800/50">
          <td colSpan={8} className="px-4 py-4">
            <SubmittalDetailEditor
              item={item}
              bidId={bidId}
              onSaved={() => {
                onEdited();
                onToggleExpand();
              }}
              onDelete={onDelete}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Detail editor (expand row) ────────────────────────────────────────────

function SubmittalDetailEditor({
  item,
  bidId,
  onSaved,
  onDelete,
}: {
  item: SubmittalRow;
  bidId: number;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [type, setType] = useState<SubmittalType>(item.type);
  const [submittalNumber, setSubmittalNumber] = useState(item.submittalNumber ?? "");
  const [reviewer, setReviewer] = useState(item.reviewer ?? "");
  const [requiredBy, setRequiredBy] = useState(
    item.requiredBy ? item.requiredBy.slice(0, 10) : ""
  );
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || item.title,
          description: description || null,
          type,
          submittalNumber: submittalNumber || null,
          reviewer: reviewer || null,
          requiredBy: requiredBy || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
      <Field label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Submittal #">
        <input
          value={submittalNumber}
          onChange={(e) => setSubmittalNumber(e.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as SubmittalType)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {SUBMITTAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Required By">
        <input
          type="date"
          value={requiredBy}
          onChange={(e) => setRequiredBy(e.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Reviewer">
        <input
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder="Architect / GC / Engineer"
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Description" fullWidth>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Notes" fullWidth>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      {err && (
        <div className="md:col-span-2 text-xs text-red-600 dark:text-red-400">{err}</div>
      )}
      <div className="md:col-span-2 flex items-center justify-between gap-2 pt-2">
        <button
          onClick={onDelete}
          className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Delete submittal
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  fullWidth,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "md:col-span-2" : ""}>
      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Add form ──────────────────────────────────────────────────────────────

function AddSubmittalForm({
  bidId,
  onCreated,
}: {
  bidId: number;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SubmittalType>("PRODUCT_DATA");
  const [description, setDescription] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type,
          description: description || null,
          requiredBy: requiredBy || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
        Add Submittal
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Structural steel shop drawings"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SubmittalType)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {SUBMITTAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Required By">
          <input
            type="date"
            value={requiredBy}
            onChange={(e) => setRequiredBy(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <Field label="Description" fullWidth>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
      </div>
      {err && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</p>
      )}
      <div className="flex justify-end mt-3">
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add Submittal"}
        </button>
      </div>
    </section>
  );
}
