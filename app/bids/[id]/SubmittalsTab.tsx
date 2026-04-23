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
  bidTradeId: number | null;
  submittalNumber: string | null;
  title: string;
  type: string;
  status: string;
  requiredBy: string | null;
  specSectionNumber: string | null;
  specSectionTitle: string | null;
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

// Phase 5G-3 — Distribution template type (mirrors API response)
type DistributionTemplate = {
  id: number;
  bidTradeId: number | null;
  tradeName: string | null;
  tradeCsiCode: string | null;
  awardedContractor: string | null;
  responsibleContractor: string | null;
  submittalManager: string | null;
  reviewers: string[];
  distribution: string[];
};

type BidTradeOption = {
  id: number;
  tradeName: string;
  tradeCsiCode: string | null;
  awardedContractor: string | null;
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
  // Orchestrator fields
  linkedActivityId: string | null;
  riskStatus: string;
  readyForExport: boolean;
  defaultLeadTimeDays: number | null;
  defaultReviewBufferDays: number | null;
  defaultResubmitBufferDays: number | null;
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

type GenerateAiResponse = {
  specResult: GenerateResult;
  jobId: string | null;
};

type DrawingPollResult = {
  status: string;
  progress: number;
  drawingItemsCreated?: number;
  specCoverageGaps?: string[];
  projectSummary?: string;
  costUsd?: number;
  error?: string;
};

type SpecMeta = {
  analyzedSectionCount: number;
  hasSpecBook: boolean;
  hasDrawings: boolean;
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
  const [generating, setGenerating] = useState(false);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [aiBanner, setAiBanner] = useState<GenerateResult | null>(null);
  const [drawingResult, setDrawingResult] = useState<DrawingPollResult | null>(null);
  const [specMeta, setSpecMeta] = useState<SpecMeta | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddPackageForm, setShowAddPackageForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [showProcurement, setShowProcurement] = useState(false);
  const [orchestrating, setOrchestrating] = useState(false);
  const [orchResult, setOrchResult] = useState<{
    packagesProcessed: number; itemsUpdated: number; linked: number;
    atRisk: number; blocked: number; readyForExport: number; warnings: string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
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
        if ((e as Error).name === "AbortError") {
          setError("Submittals load timed out");
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [bidId, reloadTick]);

  // Preflight check — tells the UI whether AI generation is ready to run
  useEffect(() => {
    fetch(`/api/bids/${bidId}/submittals/generate-ai`)
      .then((r) => r.json())
      .then((d: SpecMeta) => setSpecMeta(d))
      .catch(() => {/* non-critical */});
  }, [bidId]);

  const reload = () => setReloadTick((t) => t + 1);

  async function runGenerateFromAi() {
    setGenerating(true);
    setAiBanner(null);
    setDrawingResult(null);
    setGenJobId(null);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/submittals/generate-ai`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GenerateAiResponse;
      setAiBanner(data.specResult);
      reload();
      if (data.jobId) {
        setGenJobId(data.jobId);
        // generating stays true — polling effect will clear it
      } else {
        setGenerating(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGenerating(false);
    }
  }

  // Poll for drawing cross-reference job
  useEffect(() => {
    if (!genJobId || !generating) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/bids/${bidId}/submittals/generate-ai?jobId=${genJobId}`
        );
        const data = (await res.json()) as DrawingPollResult;
        if (data.status === "complete" || data.status === "error") {
          setGenerating(false);
          clearInterval(interval);
          if (data.status === "complete") {
            setDrawingResult(data);
            reload();
          }
          if (data.error) setError(data.error);
        }
      } catch {
        // transient — keep polling
      }
    }, 2_500);
    return () => clearInterval(interval);
  }, [bidId, genJobId, generating]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function runOrchestrate() {
    setOrchestrating(true);
    setOrchResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/procurement/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoLink: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as typeof orchResult;
      setOrchResult(data);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrchestrating(false);
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

  const canGenerate = (specMeta?.analyzedSectionCount ?? 0) > 0;

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
            disabled={generating || !canGenerate}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !canGenerate
                ? specMeta?.hasSpecBook
                  ? "Spec book needs to be analyzed first — go to Documents → AI Analyze"
                  : "Upload a spec book in the Documents tab first"
                : "Generates register from spec analysis. When drawing analysis exists, also cross-references drawing scope."
            }
          >
            {genJobId && generating
              ? "Syncing drawings…"
              : generating
              ? "Generating…"
              : "Generate from AI"}
          </button>
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              showTemplates
                ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-600 dark:bg-teal-900/30 dark:text-teal-300"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
            title="Manage per-trade routing templates (reviewer chains, distribution lists)"
          >
            Routing
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
            onClick={() => setShowProcurement(!showProcurement)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              showProcurement
                ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-900/30 dark:text-orange-300"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            Procurement
          </button>
          <button
            onClick={runOrchestrate}
            disabled={orchestrating || packages.length === 0}
            className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300 dark:hover:bg-orange-900/40"
            title="Links packages to schedule activities and computes backward submit-by dates"
          >
            {orchestrating ? "Orchestrating…" : "Orchestrate"}
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
      {specMeta && !aiBanner && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
          <p className="text-[10px] font-mono uppercase tracking-wide text-zinc-400 mb-2 dark:text-zinc-500">
            AI Generation
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className={specMeta.hasSpecBook ? "text-emerald-500" : "text-red-400"}>
                {specMeta.hasSpecBook ? "✓" : "✗"}
              </span>
              <span className={specMeta.hasSpecBook ? "text-zinc-600 dark:text-zinc-300" : "text-red-600 dark:text-red-400"}>
                Spec book
                {!specMeta.hasSpecBook && (
                  <span className="text-zinc-400 dark:text-zinc-500"> — upload one in the Documents tab</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={
                specMeta.analyzedSectionCount > 0
                  ? "text-emerald-500"
                  : specMeta.hasSpecBook
                  ? "text-amber-500"
                  : "text-zinc-300 dark:text-zinc-600"
              }>
                {specMeta.analyzedSectionCount > 0 ? "✓" : "–"}
              </span>
              <span className={
                specMeta.analyzedSectionCount > 0
                  ? "text-zinc-600 dark:text-zinc-300"
                  : specMeta.hasSpecBook
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-zinc-400 dark:text-zinc-600"
              }>
                Spec analysis
                {specMeta.analyzedSectionCount > 0 ? (
                  <span className="text-zinc-400 dark:text-zinc-500"> — {specMeta.analyzedSectionCount} sections ready</span>
                ) : specMeta.hasSpecBook ? (
                  <span> — go to Documents → AI Analyze</span>
                ) : null}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={specMeta.hasDrawings ? "text-emerald-500" : "text-zinc-300 dark:text-zinc-600"}>
                {specMeta.hasDrawings ? "✓" : "–"}
              </span>
              <span className="text-zinc-400 dark:text-zinc-500">
                Drawing cross-reference
                {specMeta.hasDrawings ? " — will run" : " — optional, upload drawings to enable"}
              </span>
            </div>
          </div>
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
          {genJobId && generating && (
            <span className="ml-2 opacity-70">Cross-referencing drawings…</span>
          )}
          {drawingResult?.drawingItemsCreated != null && drawingResult.drawingItemsCreated > 0 && (
            <span className="ml-2">
              +<strong>{drawingResult.drawingItemsCreated}</strong> drawing-sourced additions.
            </span>
          )}
          {drawingResult?.drawingItemsCreated === 0 && (
            <span className="ml-2 opacity-60">Drawing scope fully covered by specs.</span>
          )}
        </div>
      )}

      {/* ── Orchestrate result banner ── */}
      {orchResult && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
          Orchestrated {orchResult.packagesProcessed} packages · {orchResult.itemsUpdated} items updated
          {orchResult.linked > 0 && ` · ${orchResult.linked} newly linked to schedule`}
          {orchResult.blocked > 0 && ` · `}
          {orchResult.blocked > 0 && <strong>{orchResult.blocked} blocked</strong>}
          {orchResult.atRisk > 0 && ` · ${orchResult.atRisk} at risk`}
          {orchResult.readyForExport > 0 && ` · ${orchResult.readyForExport} ready for export`}
          {orchResult.warnings.map((w, i) => (
            <span key={i} className="block mt-1 text-orange-500 dark:text-orange-400">{w}</span>
          ))}
        </div>
      )}

      {/* ── Procurement Control panel ── */}
      {showProcurement && (
        <section className="rounded-lg border border-orange-200 bg-orange-50/40 dark:border-orange-900/60 dark:bg-orange-950/20 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-orange-200 dark:border-orange-900/60">
            <div>
              <p className="text-xs font-semibold text-orange-800 dark:text-orange-300">Procurement Control</p>
              <p className="text-[11px] text-orange-600 dark:text-orange-500 mt-0.5">
                Schedule linkage · backward date math · export readiness
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {(() => {
                const blocked = packages.filter(p => p.riskStatus === "BLOCKED").length;
                const atRisk = packages.filter(p => p.riskStatus === "AT_RISK").length;
                const ready = packages.filter(p => p.readyForExport).length;
                const unlinked = packages.filter(p => !p.linkedActivityId).length;
                return (
                  <div className="flex gap-3 text-[11px] font-mono">
                    {blocked > 0 && <span className="text-red-600 dark:text-red-400">{blocked} blocked</span>}
                    {atRisk > 0 && <span className="text-amber-600 dark:text-amber-400">{atRisk} at risk</span>}
                    {unlinked > 0 && <span className="text-zinc-500 dark:text-zinc-400">{unlinked} unlinked</span>}
                    <span className="text-emerald-600 dark:text-emerald-400">{ready} ready</span>
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {packages.map(pkg => {
              const openCount = pkg.items.filter(i => i.status !== "APPROVED" && i.status !== "APPROVED_AS_NOTED").length;
              const nearestSBD = pkg.items
                .map(i => i.submitByDate)
                .filter((d): d is string => d !== null)
                .sort()[0] ?? null;
              const riskColor = pkg.riskStatus === "BLOCKED"
                ? "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/30"
                : pkg.riskStatus === "AT_RISK"
                ? "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20"
                : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900";
              const riskBadge = pkg.riskStatus === "BLOCKED"
                ? <span className="text-[10px] font-mono font-semibold text-red-600 dark:text-red-400">BLOCKED</span>
                : pkg.riskStatus === "AT_RISK"
                ? <span className="text-[10px] font-mono font-semibold text-amber-600 dark:text-amber-400">AT RISK</span>
                : <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">ON TRACK</span>;
              return (
                <div key={pkg.id} className={`rounded-md border p-3 flex flex-col gap-2 ${riskColor}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">{pkg.packageNumber}</p>
                      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 leading-tight">{pkg.name}</p>
                    </div>
                    {riskBadge}
                  </div>
                  <div className="flex flex-col gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>{openCount} open / {pkg.total} total</span>
                    {nearestSBD && (
                      <span>
                        submit by{" "}
                        <span className={new Date(nearestSBD) < new Date() ? "text-red-500 font-semibold" : "text-zinc-700 dark:text-zinc-300"}>
                          {new Date(nearestSBD).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </span>
                    )}
                    {!pkg.linkedActivityId && (
                      <span className="text-zinc-400 dark:text-zinc-500 italic">not linked to schedule</span>
                    )}
                  </div>
                  {pkg.readyForExport && (
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">✓ ready for export</span>
                  )}
                </div>
              );
            })}
            {packages.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500 col-span-3 text-center py-4">
                No packages. Create packages and run Orchestrate to compute procurement dates.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Distribution Routing Templates panel ── */}
      {showTemplates && (
        <DistributionTemplatesPanel
          bidId={bidId}
          onApplied={reload}
        />
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
              {item.specSectionNumber}{item.specSectionTitle ? ` — ${item.specSectionTitle}` : ""}
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

// ── Distribution Routing Templates Panel ──────────────────────────────────

function DistributionTemplatesPanel({
  bidId,
  onApplied,
}: {
  bidId: number;
  onApplied: () => void;
}) {
  const [templates, setTemplates] = useState<DistributionTemplate[]>([]);
  const [bidTrades, setBidTrades] = useState<BidTradeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Which template row is being edited (id → field → value)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFields, setEditFields] = useState<{
    responsibleContractor: string;
    submittalManager: string;
    reviewers: string;
    distribution: string;
  }>({ responsibleContractor: "", submittalManager: "", reviewers: "", distribution: "" });
  // New template form
  const [showAdd, setShowAdd] = useState(false);
  const [newTradeId, setNewTradeId] = useState<string>("");

  const reload = () => {
    setLoading(true);
    fetch(`/api/bids/${bidId}/submittals/distribution-templates`)
      .then((r) => r.json())
      .then((data: { templates: DistributionTemplate[]; bidTrades: BidTradeOption[] }) => {
        setTemplates(data.templates ?? []);
        setBidTrades(data.bidTrades ?? []);
        setErr(null);
      })
      .catch((e: unknown) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [bidId]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(t: DistributionTemplate) {
    setEditingId(t.id);
    setEditFields({
      responsibleContractor: t.responsibleContractor ?? "",
      submittalManager: t.submittalManager ?? "",
      reviewers: t.reviewers.join(", "),
      distribution: t.distribution.join(", "),
    });
  }

  async function saveEdit(id: number) {
    const splitList = (s: string) =>
      s.split(",").map((v) => v.trim()).filter(Boolean);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/distribution-templates/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            responsibleContractor: editFields.responsibleContractor || null,
            submittalManager: editFields.submittalManager || null,
            reviewers: splitList(editFields.reviewers),
            distribution: splitList(editFields.distribution),
          }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingId(null);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteTemplate(id: number) {
    if (!confirm("Delete this routing template?")) return;
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/distribution-templates/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function createTemplate() {
    const tradeId = newTradeId ? parseInt(newTradeId, 10) : null;
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/distribution-templates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidTradeId: tradeId }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { id: number };
      setShowAdd(false);
      setNewTradeId("");
      reload();
      // Immediately open the new row for editing
      setTimeout(() => {
        setEditingId(data.id);
        setEditFields({ responsibleContractor: "", submittalManager: "", reviewers: "", distribution: "" });
      }, 200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function applyToPackages() {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/submittals/distribution-templates/apply`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { updated: number };
      setApplyResult(`Applied to ${data.updated} package${data.updated !== 1 ? "s" : ""}.`);
      onApplied();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  const existingTradeIds = new Set(templates.map((t) => t.bidTradeId));
  const availableTrades = bidTrades.filter((bt) => !existingTradeIds.has(bt.id));

  return (
    <section className="rounded-lg border border-teal-200 bg-teal-50/30 dark:border-teal-800 dark:bg-teal-950/20 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-teal-100 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-900/20">
        <div>
          <span className="text-sm font-semibold text-teal-800 dark:text-teal-200">
            Routing Templates
          </span>
          <span className="ml-2 text-xs text-teal-600 dark:text-teal-400">
            Per-trade defaults for contractor, reviewer chain &amp; distribution
          </span>
        </div>
        <div className="flex items-center gap-2">
          {applyResult && (
            <span className="text-xs text-teal-700 dark:text-teal-300">{applyResult}</span>
          )}
          <button
            onClick={applyToPackages}
            disabled={applying || templates.length === 0}
            className="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            title="Push template values to matching packages"
          >
            {applying ? "Applying…" : "Apply to Packages"}
          </button>
        </div>
      </div>

      {err && (
        <p className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{err}</p>
      )}

      {loading ? (
        <p className="px-4 py-3 text-xs text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-zinc-400 uppercase tracking-wide border-b border-teal-100 dark:border-teal-800/60">
                <th className="px-3 py-2 w-32">Trade</th>
                <th className="px-3 py-2">Responsible Contractor</th>
                <th className="px-3 py-2">Submittal Manager</th>
                <th className="px-3 py-2">Reviewers (comma-sep)</th>
                <th className="px-3 py-2">Distribution (comma-sep)</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-teal-50 dark:divide-teal-900/40">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-teal-50/50 dark:hover:bg-teal-900/20">
                  <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                    {t.tradeName ?? "—"}
                    {t.tradeCsiCode && (
                      <span className="ml-1 text-zinc-400 font-mono text-[10px]">
                        {t.tradeCsiCode}
                      </span>
                    )}
                  </td>
                  {editingId === t.id ? (
                    <>
                      <td className="px-2 py-1">
                        <input
                          value={editFields.responsibleContractor}
                          onChange={(e) => setEditFields((f) => ({ ...f, responsibleContractor: e.target.value }))}
                          placeholder={t.awardedContractor ?? "e.g. ABC Mechanical LLC"}
                          className="w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={editFields.submittalManager}
                          onChange={(e) => setEditFields((f) => ({ ...f, submittalManager: e.target.value }))}
                          placeholder="e.g. John Smith, PM"
                          className="w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={editFields.reviewers}
                          onChange={(e) => setEditFields((f) => ({ ...f, reviewers: e.target.value }))}
                          placeholder="Architect, Engineer"
                          className="w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={editFields.distribution}
                          onChange={(e) => setEditFields((f) => ({ ...f, distribution: e.target.value }))}
                          placeholder="Owner Rep, Inspector"
                          className="w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1">
                          <button
                            onClick={() => saveEdit(t.id)}
                            className="rounded bg-teal-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-teal-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-[10px]"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                        {t.responsibleContractor ?? (
                          <span className="text-zinc-300 dark:text-zinc-600 italic">
                            {t.awardedContractor ? `← ${t.awardedContractor}` : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                        {t.submittalManager ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                        {t.reviewers.length > 0
                          ? t.reviewers.join(" → ")
                          : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                        {t.distribution.length > 0
                          ? t.distribution.join(", ")
                          : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(t)}
                            className="text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-200 text-[10px] font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteTemplate(t.id)}
                            className="text-zinc-300 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400 text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}

              {templates.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-zinc-400 dark:text-zinc-500 italic">
                    No templates yet. Add one per trade below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add template row */}
      <div className="px-4 py-2.5 border-t border-teal-100 dark:border-teal-800/60">
        {showAdd ? (
          <div className="flex items-center gap-2">
            <select
              value={newTradeId}
              onChange={(e) => setNewTradeId(e.target.value)}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">— select trade —</option>
              {availableTrades.map((bt) => (
                <option key={bt.id} value={String(bt.id)}>
                  {bt.tradeName}
                  {bt.awardedContractor ? ` (${bt.awardedContractor})` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={createTemplate}
              disabled={!newTradeId}
              className="rounded bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            disabled={availableTrades.length === 0}
            className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Add template for trade
          </button>
        )}
      </div>
    </section>
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
  const [template, setTemplate] = useState<DistributionTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/bids/${bidId}/schedule-v2`)
        .then((r) => r.json())
        .catch(() => ({})),
      fetch(`/api/bids/${bidId}/submittals/distribution-templates`)
        .then((r) => r.json())
        .catch(() => ({ templates: [] })),
    ]).then(([schedData, tmplData]) => {
      if (schedData?.activities) {
        setActivities(
          (schedData.activities as ActivityOption[]).filter(
            (a) => !a.name.match(/^\d+\.0\s/)
          )
        );
      }
      if (tmplData?.templates && item.bidTradeId != null) {
        const match = (tmplData.templates as DistributionTemplate[]).find(
          (t) => t.bidTradeId === item.bidTradeId
        );
        setTemplate(match ?? null);
      }
    });
  }, [bidId, item.bidTradeId]);

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

      {/* Phase 5G-3 — Routing template hint */}
      {template && (
        <div className="md:col-span-2 rounded-md bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-teal-700 dark:text-teal-300">
              Routing template · {template.tradeName}
            </span>
            <button
              type="button"
              onClick={() => {
                if (template.reviewers.length > 0)
                  setReviewer(template.reviewers.join(", "));
              }}
              className="rounded px-2 py-0.5 text-[10px] font-medium bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-800"
              title="Copy reviewer chain from template into the Reviewer field"
            >
              Apply reviewers
            </button>
          </div>
          {template.responsibleContractor && (
            <div className="text-teal-800 dark:text-teal-200">
              <span className="opacity-70">Responsible:</span>{" "}
              {template.responsibleContractor}
            </div>
          )}
          {template.submittalManager && (
            <div className="text-teal-800 dark:text-teal-200">
              <span className="opacity-70">Manager:</span>{" "}
              {template.submittalManager}
            </div>
          )}
          {template.reviewers.length > 0 && (
            <div className="text-teal-800 dark:text-teal-200">
              <span className="opacity-70">Reviewers:</span>{" "}
              {template.reviewers.join(" → ")}
            </div>
          )}
          {template.distribution.length > 0 && (
            <div className="text-teal-800 dark:text-teal-200">
              <span className="opacity-70">Distribution:</span>{" "}
              {template.distribution.join(", ")}
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
