"use client";

// Phase 5G-3.5/3.6 — Package-grouped Submittal Register
//
// Replaces the flat table (Module H3) with collapsible trade-based packages.
// Data comes from GET /api/bids/[id]/submittals/packages which returns packages
// with their items + an unassigned bucket + an overall rollup.
//
// Inline editing: click a Status badge or Due date cell to edit in place.
// Full field editing is in the expand-row detail editor (unchanged from H3).

import { useEffect, useRef, useState } from "react";

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
  PENDING: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  REQUESTED: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  RECEIVED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  UNDER_REVIEW:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  APPROVED_AS_NOTED:
    "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  RESUBMIT:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

const PKG_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  CLOSED: "Closed",
};

type PackageItemRow = {
  id: number;
  submittalNumber: string | null;
  title: string;
  type: string;
  status: string;
  requiredBy: string | null;
  specSectionNumber: string | null;
  responsibleSubId: number | null;
  responsibleSubName: string | null;
  reviewer: string | null;
  notes: string | null;
  description: string | null;
  isOverdue: boolean;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "INFO" | null;
  tradeName?: string | null;
  // Phase 5G-2
  linkedActivityId: string | null;
  leadTimeDays: number;
  reviewBufferDays: number;
  resubmitBufferDays: number;
  requiredOnSiteDate: string | null;
  submitByDate: string | null;
};

type PackageRow = {
  id: number;
  packageNumber: string;
  name: string;
  bidTradeId: number | null;
  tradeName: string | null;
  status: string;
  responsibleContractor: string | null;
  submittalManager: string | null;
  total: number;
  approved: number;
  overdue: number;
  items: PackageItemRow[];
};

type ApiRollup = {
  total: number;
  open: number;
  approved: number;
  overdue: number;
  critical: number;
};

type GenerateResult = {
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

type FilterChip = "all" | "open" | "overdue" | "critical";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function toInputDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const isTerminal = (s: string) => s === "APPROVED" || s === "APPROVED_AS_NOTED";

// ── Shared prop type for item grid ─────────────────────────────────────────

type SharedItemProps = {
  bidId: number;
  expandedId: number | null;
  editingCell: {
    itemId: number;
    field: "status" | "requiredBy";
  } | null;
  onToggleExpand: (id: number) => void;
  onEditCell: (
    cell: { itemId: number; field: "status" | "requiredBy" } | null
  ) => void;
  onPatch: (itemId: number, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (itemId: number) => void;
  onEdited: () => void;
};

// ── Main component ─────────────────────────────────────────────────────────

export default function SubmittalsTab({ bidId }: { bidId: number }) {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [unassigned, setUnassigned] = useState<PackageItemRow[]>([]);
  const [rollup, setRollup] = useState<ApiRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterChip>("all");
  const [collapsedPkgs, setCollapsedPkgs] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{
    itemId: number;
    field: "status" | "requiredBy";
  } | null>(null);
  const [generatingFromAi, setGeneratingFromAi] = useState(false);
  const [aiBanner, setAiBanner] = useState<GenerateResult | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddPackageForm, setShowAddPackageForm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/submittals/packages`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          packages: PackageRow[];
          unassigned: PackageItemRow[];
          rollup: ApiRollup;
        };
        if (cancelled) return;
        setPackages(data.packages);
        setUnassigned(data.unassigned);
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
  }, [bidId, reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  async function runGenerateFromAi() {
    setGeneratingFromAi(true);
    setAiBanner(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/generate-from-specs`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GenerateResult;
      setAiBanner(data);
      reload();
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
      const res = await fetch(`/api/bids/${bidId}/submittals/export`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
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

  async function patchItem(
    itemId: number,
    patch: Record<string, unknown>
  ): Promise<void> {
    const res = await fetch(`/api/bids/${bidId}/submittals/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    reload();
  }

  async function deleteItem(itemId: number) {
    if (!confirm("Delete this submittal?")) return;
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deletePackage(pkgId: number) {
    if (!confirm("Delete this package? Items will become unassigned.")) return;
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/packages/${pkgId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function renamePackage(pkgId: number, name: string) {
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/packages/${pkgId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function filterItems(items: PackageItemRow[]): PackageItemRow[] {
    if (filter === "open") return items.filter((i) => !isTerminal(i.status));
    if (filter === "overdue") return items.filter((i) => i.isOverdue);
    if (filter === "critical") return items.filter((i) => i.severity === "CRITICAL");
    return items;
  }

  function toggleCollapse(key: number) {
    setCollapsedPkgs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Loading submittal register…
      </p>
    );
  }

  const totalItems = rollup?.total ?? 0;

  const sharedItemProps: SharedItemProps = {
    bidId,
    expandedId,
    editingCell,
    onToggleExpand: (id) =>
      setExpandedId(expandedId === id ? null : id),
    onEditCell: setEditingCell,
    onPatch: async (itemId, patch) => {
      try {
        await patchItem(itemId, patch);
        setEditingCell(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    onDelete: deleteItem,
    onEdited: reload,
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header + Actions ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Submittal Register
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Package-grouped by trade. Click status or due date to edit inline.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={runGenerateFromAi}
            disabled={generatingFromAi}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            title="Regenerates register from AI Spec Analysis. Replaces auto-generated items; manual entries preserved."
          >
            {generatingFromAi ? "Generating…" : "Generate from AI"}
          </button>
          <button
            onClick={() => setShowAddPackageForm(!showAddPackageForm)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            + Package
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {showAddForm ? "Cancel" : "+ Item"}
          </button>
          <button
            onClick={runExport}
            disabled={exporting || totalItems === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {/* ── Banners ── */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}
      {aiBanner && (
        <div className="rounded-md border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-700 dark:border-purple-900 dark:bg-purple-900/30 dark:text-purple-300">
          AI read {aiBanner.sectionsWithExtractions} sections, found{" "}
          <strong>{aiBanner.submittalsFound}</strong> requirements.
          {aiBanner.previousAutoItemsRemoved > 0 &&
            ` Replaced ${aiBanner.previousAutoItemsRemoved} prior items.`}{" "}
          Created <strong>{aiBanner.created}</strong> items
          {aiBanner.skippedProcedural > 0 &&
            `, skipped ${aiBanner.skippedProcedural} Div 00/01`}
          {aiBanner.skippedBoilerplate > 0 &&
            `, ${aiBanner.skippedBoilerplate} boilerplate`}
          {aiBanner.deferredToCloseout > 0 &&
            `, ${aiBanner.deferredToCloseout} deferred to closeout`}
          {aiBanner.bidTradesLinked > 0 &&
            ` · ${aiBanner.bidTradesLinked} linked to trades`}.
        </div>
      )}

      {/* ── Add Package form ── */}
      {showAddPackageForm && (
        <AddPackageForm
          bidId={bidId}
          onCreated={() => {
            setShowAddPackageForm(false);
            reload();
          }}
          onCancel={() => setShowAddPackageForm(false)}
        />
      )}

      {/* ── Add Item form ── */}
      {showAddForm && (
        <AddSubmittalForm
          bidId={bidId}
          onCreated={() => {
            setShowAddForm(false);
            reload();
          }}
        />
      )}

      {/* ── Rollup ── */}
      {rollup && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
            <RollupStat label="Total" value={rollup.total} />
            <RollupStat label="Open" value={rollup.open} />
            <RollupStat label="Approved" value={rollup.approved} />
            <RollupStat
              label="Overdue"
              value={rollup.overdue}
              tone={rollup.overdue > 0 ? "warn" : undefined}
            />
            <RollupStat
              label="Critical"
              value={rollup.critical}
              tone={rollup.critical > 0 ? "warn" : undefined}
            />
          </div>
        </section>
      )}

      {/* ── Filter chips ── */}
      <div className="flex gap-2 flex-wrap">
        {(
          [
            ["all", "All", null],
            ["open", "Open", rollup?.open ?? 0],
            ["overdue", "Overdue", rollup?.overdue ?? 0],
            ["critical", "Critical", rollup?.critical ?? 0],
          ] as const
        ).map(([chip, label, count]) => (
          <button
            key={chip}
            onClick={() => setFilter(chip)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === chip
                ? "bg-purple-600 text-white"
                : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {label}
            {count !== null && (
              <span className="ml-1.5 opacity-70">({count})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Empty state ── */}
      {totalItems === 0 && (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No submittals yet. Click &ldquo;Generate from AI&rdquo; to extract
            from spec book, or add one manually.
          </p>
        </section>
      )}

      {/* ── Package sections ── */}
      {packages.map((pkg) => {
        const visible = filterItems(pkg.items);
        if (filter !== "all" && visible.length === 0) return null;
        return (
          <PackageSection
            key={pkg.id}
            pkg={pkg}
            visibleItems={visible}
            collapsed={collapsedPkgs.has(pkg.id)}
            onToggleCollapse={() => toggleCollapse(pkg.id)}
            onDeletePackage={() => deletePackage(pkg.id)}
            onRenamed={(name) => renamePackage(pkg.id, name)}
            {...sharedItemProps}
          />
        );
      })}

      {/* ── Unassigned section ── */}
      {unassigned.length > 0 &&
        (() => {
          const visible = filterItems(unassigned);
          if (filter !== "all" && visible.length === 0) return null;
          return (
            <UnassignedSection
              items={visible}
              totalCount={unassigned.length}
              collapsed={collapsedPkgs.has(-1)}
              onToggleCollapse={() => toggleCollapse(-1)}
              {...sharedItemProps}
            />
          );
        })()}
    </div>
  );
}

// ── Package Section ────────────────────────────────────────────────────────

function PackageSection({
  pkg,
  visibleItems,
  collapsed,
  onToggleCollapse,
  onDeletePackage,
  onRenamed,
  ...shared
}: {
  pkg: PackageRow;
  visibleItems: PackageItemRow[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDeletePackage: () => void;
  onRenamed: (name: string) => void;
} & SharedItemProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(pkg.name);
  const nameRef = useRef<HTMLInputElement>(null);

  function commitName() {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== pkg.name) onRenamed(trimmed);
    setEditingName(false);
  }

  const pct =
    pkg.total > 0 ? Math.round((pkg.approved / pkg.total) * 100) : 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      {/* Package header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40">
        <button
          onClick={onToggleCollapse}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-[10px] w-3 shrink-0"
        >
          {collapsed ? "▶" : "▼"}
        </button>

        {/* Package number badge */}
        <span className="font-mono text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 shrink-0">
          {pkg.packageNumber}
        </span>

        {/* Package name (click to rename) */}
        {editingName ? (
          <input
            ref={nameRef}
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameVal(pkg.name);
                setEditingName(false);
              }
            }}
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent border-b border-zinc-400 outline-none px-0 min-w-0 w-40"
            autoFocus
          />
        ) : (
          <button
            onClick={() => {
              setEditingName(true);
              setNameVal(pkg.name);
              setTimeout(() => nameRef.current?.select(), 0);
            }}
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-purple-600 dark:hover:text-purple-400 text-left truncate"
          >
            {pkg.name}
          </button>
        )}

        {pkg.tradeName && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate hidden sm:block">
            {pkg.tradeName}
          </span>
        )}

        {/* Right side: overdue warning, progress, status, delete */}
        <div className="flex items-center gap-2.5 ml-auto shrink-0">
          {pkg.overdue > 0 && (
            <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
              {pkg.overdue} overdue
            </span>
          )}

          <div className="flex items-center gap-1.5">
            <div className="w-16 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
              {pkg.approved}/{pkg.total}
            </span>
          </div>

          <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 hidden sm:inline">
            {PKG_STATUS_LABELS[pkg.status] ?? pkg.status}
          </span>

          <button
            onClick={onDeletePackage}
            title="Delete package (items become unassigned)"
            className="text-zinc-300 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400 text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && <SubmittalGrid items={visibleItems} {...shared} />}
    </section>
  );
}

// ── Unassigned Section ─────────────────────────────────────────────────────

function UnassignedSection({
  items,
  totalCount,
  collapsed,
  onToggleCollapse,
  ...shared
}: {
  items: PackageItemRow[];
  totalCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
} & SharedItemProps) {
  return (
    <section className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 cursor-pointer"
        onClick={onToggleCollapse}
      >
        <span className="text-zinc-400 dark:text-zinc-500 text-[10px] w-3">
          {collapsed ? "▶" : "▼"}
        </span>
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Unassigned
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          · {totalCount} items
        </span>
      </div>
      {!collapsed && <SubmittalGrid items={items} {...shared} />}
    </section>
  );
}

// ── Submittal Grid ─────────────────────────────────────────────────────────

function SubmittalGrid({
  items,
  ...shared
}: { items: PackageItemRow[] } & SharedItemProps) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-zinc-400 dark:text-zinc-500 italic">
        No items match the current filter.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[10px] font-semibold text-zinc-400 uppercase tracking-wide border-b border-zinc-100 dark:border-zinc-800">
          <th className="px-3 py-2 w-12">Risk</th>
          <th className="px-3 py-2 w-20">#</th>
          <th className="px-3 py-2">Title</th>
          <th className="px-3 py-2 w-24 hidden md:table-cell">Type</th>
          <th className="px-3 py-2 w-32 hidden lg:table-cell">Sub</th>
          <th className="px-3 py-2 w-24">Due</th>
          <th className="px-3 py-2 w-24 hidden lg:table-cell" title="Schedule-tied submit-by date (backward math from install activity)">Submit By</th>
          <th className="px-3 py-2 w-36">Status</th>
          <th className="px-3 py-2 w-10"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
        {items.map((item) => (
          <SubmittalGridRow key={item.id} item={item} {...shared} />
        ))}
      </tbody>
    </table>
  );
}

// ── Grid Row ───────────────────────────────────────────────────────────────

function SubmittalGridRow({
  item,
  bidId,
  expandedId,
  editingCell,
  onToggleExpand,
  onEditCell,
  onPatch,
  onDelete,
  onEdited,
}: { item: PackageItemRow } & SharedItemProps) {
  const isExpanded = expandedId === item.id;
  const editing = editingCell?.itemId === item.id ? editingCell.field : null;

  return (
    <>
      <tr
        className={
          item.isOverdue
            ? "bg-red-50/30 dark:bg-red-900/5"
            : "hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
        }
      >
        {/* Risk */}
        <td className="px-3 py-2">
          <SeverityBadge severity={item.severity} />
        </td>

        {/* # */}
        <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {item.submittalNumber ?? "—"}
        </td>

        {/* Title + spec section */}
        <td className="px-3 py-2">
          <div className="font-medium text-zinc-800 dark:text-zinc-100 leading-tight text-xs">
            {item.title}
          </div>
          {item.specSectionNumber && (
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
              Spec {item.specSectionNumber}
            </div>
          )}
          {item.tradeName && (
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {item.tradeName}
            </div>
          )}
        </td>

        {/* Type */}
        <td className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
          {TYPE_LABELS[item.type as SubmittalType] ?? item.type}
        </td>

        {/* Sub (display only — assign via detail editor) */}
        <td className="px-3 py-2 text-[11px] hidden lg:table-cell">
          {item.responsibleSubName ? (
            <span className="text-zinc-600 dark:text-zinc-300">
              {item.responsibleSubName}
            </span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600 italic">
              unassigned
            </span>
          )}
        </td>

        {/* Due — inline editable */}
        <td className="px-3 py-2">
          {editing === "requiredBy" ? (
            <input
              type="date"
              defaultValue={toInputDate(item.requiredBy)}
              onBlur={(e) =>
                onPatch(item.id, { requiredBy: e.target.value || null })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") onEditCell(null);
              }}
              autoFocus
              className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-zinc-100 outline-none w-28"
            />
          ) : (
            <button
              onClick={() =>
                onEditCell({ itemId: item.id, field: "requiredBy" })
              }
              className={`text-xs ${
                item.isOverdue
                  ? "text-red-600 dark:text-red-400 font-semibold"
                  : "text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {fmtDate(item.requiredBy)}
            </button>
          )}
        </td>

        {/* Submit By — schedule-derived, read-only */}
        <td className="px-3 py-2 hidden lg:table-cell">
          {item.submitByDate ? (
            <span
              className={`text-xs ${
                !isTerminal(item.status) && new Date(item.submitByDate) < new Date()
                  ? "text-red-600 dark:text-red-400 font-semibold"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
              title={`Required on site: ${fmtDate(item.requiredOnSiteDate)}\nLead: ${item.leadTimeDays}d  Review: ${item.reviewBufferDays}d  Resubmit: ${item.resubmitBufferDays}d`}
            >
              {fmtDate(item.submitByDate)}
            </span>
          ) : (
            <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>

        {/* Status — inline editable */}
        <td className="px-3 py-2">
          {editing === "status" ? (
            <select
              defaultValue={item.status}
              onChange={(e) =>
                onPatch(item.id, { status: e.target.value })
              }
              onBlur={() => onEditCell(null)}
              autoFocus
              className="text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100 px-1 py-0.5 outline-none"
            >
              {SUBMITTAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={() =>
                onEditCell({ itemId: item.id, field: "status" })
              }
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                STATUS_STYLES[item.status as SubmittalStatus] ?? ""
              }`}
            >
              {STATUS_LABELS[item.status as SubmittalStatus] ?? item.status}
            </button>
          )}
        </td>

        {/* Expand toggle */}
        <td className="px-2 py-2 text-right">
          <button
            onClick={() => onToggleExpand(item.id)}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-200"
            title={isExpanded ? "Collapse" : "Edit details"}
          >
            {isExpanded ? "▲" : "▼"}
          </button>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-zinc-50 dark:bg-zinc-800/50">
          <td colSpan={9} className="px-4 py-4">
            <SubmittalDetailEditor
              item={item}
              bidId={bidId}
              onSaved={() => {
                onEdited();
                onToggleExpand(item.id);
              }}
              onDelete={() => onDelete(item.id)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Severity Badge ─────────────────────────────────────────────────────────

function SeverityBadge({
  severity,
}: {
  severity: PackageItemRow["severity"];
}) {
  if (!severity)
    return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
  const styles: Record<NonNullable<PackageItemRow["severity"]>, string> = {
    CRITICAL: "bg-red-600 text-white",
    HIGH: "bg-orange-500 text-white",
    MODERATE: "bg-amber-400 text-amber-900",
    LOW: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    INFO: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  };
  const labels: Record<NonNullable<PackageItemRow["severity"]>, string> = {
    CRITICAL: "CRIT",
    HIGH: "HIGH",
    MODERATE: "MOD",
    LOW: "LOW",
    INFO: "INFO",
  };
  return (
    <span
      className={`inline-block rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide ${styles[severity]}`}
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

// ── Add Package Form ───────────────────────────────────────────────────────

function AddPackageForm({
  bidId,
  onCreated,
  onCancel,
}: {
  bidId: number;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
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
        New Package
      </h3>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Package Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Structural Steel"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
      {err && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</p>
      )}
    </section>
  );
}

// ── Detail Editor (expand row) ─────────────────────────────────────────────

type ActivityOption = { id: string; activityCode: string; name: string; startDate: string | null };

function SubmittalDetailEditor({
  item,
  bidId,
  onSaved,
  onDelete,
}: {
  item: PackageItemRow;
  bidId: number;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [type, setType] = useState<SubmittalType>(item.type as SubmittalType);
  const [submittalNumber, setSubmittalNumber] = useState(item.submittalNumber ?? "");
  const [reviewer, setReviewer] = useState(item.reviewer ?? "");
  const [requiredBy, setRequiredBy] = useState(toInputDate(item.requiredBy));
  const [notes, setNotes] = useState(item.notes ?? "");
  // Phase 5G-2
  const [linkedActivityId, setLinkedActivityId] = useState(item.linkedActivityId ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState(item.leadTimeDays);
  const [reviewBufferDays, setReviewBufferDays] = useState(item.reviewBufferDays);
  const [resubmitBufferDays, setResubmitBufferDays] = useState(item.resubmitBufferDays);
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/schedule-v2`)
      .then((r) => r.json())
      .then((data: { activities?: ActivityOption[] }) => {
        if (data.activities) {
          setActivities(data.activities.filter((a) => !a.name.match(/^\d+\.0\s/)));
        }
      })
      .catch(() => {});
  }, [bidId]);

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
          linkedActivityId: linkedActivityId || null,
          leadTimeDays,
          reviewBufferDays,
          resubmitBufferDays,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const derivedOnSite = item.requiredOnSiteDate ? fmtDate(item.requiredOnSiteDate) : null;
  const derivedSubmitBy = item.submitByDate ? fmtDate(item.submitByDate) : null;

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

      {/* Phase 5G-2 — Schedule link */}
      <Field label="Linked Schedule Activity" fullWidth>
        <select
          value={linkedActivityId}
          onChange={(e) => setLinkedActivityId(e.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">— not linked —</option>
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              [{a.activityCode}] {a.name}{a.startDate ? ` — starts ${fmtDate(a.startDate)}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Mfr Lead Time (working days)">
        <input
          type="number"
          min={0}
          value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Review Buffer (working days)">
        <input
          type="number"
          min={0}
          value={reviewBufferDays}
          onChange={(e) => setReviewBufferDays(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      <Field label="Resubmit Buffer (working days)">
        <input
          type="number"
          min={0}
          value={resubmitBufferDays}
          onChange={(e) => setResubmitBufferDays(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </Field>
      {(derivedSubmitBy || derivedOnSite) && (
        <div className="md:col-span-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-3 py-2 text-xs space-y-1">
          {derivedSubmitBy && (
            <div>
              <span className="font-semibold text-blue-700 dark:text-blue-300">Submit By: </span>
              <span className={`${item.submitByDate && !isTerminal(item.status) && new Date(item.submitByDate) < new Date() ? "text-red-600 dark:text-red-400 font-semibold" : "text-blue-800 dark:text-blue-200"}`}>
                {derivedSubmitBy}
              </span>
            </div>
          )}
          {derivedOnSite && (
            <div>
              <span className="font-semibold text-blue-700 dark:text-blue-300">Required On Site: </span>
              <span className="text-blue-800 dark:text-blue-200">{derivedOnSite}</span>
            </div>
          )}
        </div>
      )}

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
        <div className="md:col-span-2 text-xs text-red-600 dark:text-red-400">
          {err}
        </div>
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

// ── Field wrapper ──────────────────────────────────────────────────────────

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

// ── Add Item Form ──────────────────────────────────────────────────────────

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
        const e = (await res.json().catch(() => ({}))) as { error?: string };
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
