"use client";

// Tier F — Procore Tab
//
// F1 (complete): Download CSV files for manual Procore import.
// F2 (complete): Push directly to Procore REST API.
// F3 (this): Bidirectional sync — pull RFIs, sync submittal statuses, webhook setup.
//
// Layout:
//   • Header (credentials banner if creds missing)
//   • Project connection panel
//   • Step 1–3: Push cards (vendor dir, contacts, budget, submittal log)
//   • Step 4: Pull from Procore (RFI sync, submittal status sync)
//   • Webhook setup (register/unregister Procore webhook)
//   • Import order info card

import { useEffect, useState, useCallback } from "react";
import {
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Link2,
  Link2Off,
  ArrowUpFromLine,
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  Settings,
  RefreshCw,
  Webhook,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProcoreStats = {
  vendors: number;
  budgetTradeLines: number;
  budgetGcLines: number;
  submittals: number;
  contacts: number;
  scheduleActivities: number;
};

type ProcoreProject = {
  id: number;
  name: string;
  projectNumber: string | null;
  status: string | null;
};

type PushStatus = {
  type: string;
  pushedAt: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type PushState = "idle" | "pushing" | "done" | "error";

type PushResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type RfiItem = {
  id: number;
  procoreRfiId: number | null;
  number: string;
  title: string;
  question: string | null;
  answer: string | null;
  status: string;
  priority: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  syncedAt: string | null;
};

type WebhookStatus = {
  registered: boolean;
  hookId: number | null;
  hookUrl: string | null;
  totalHooks: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function downloadCsv(url: string, fallbackName: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return json.error ?? `HTTP ${res.status}`;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const fileName = match ? match[1] : fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function rfiStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "closed") return "text-zinc-400 dark:text-zinc-500";
  if (s === "draft") return "text-zinc-500 dark:text-zinc-400";
  return "text-amber-600 dark:text-amber-400";
}

// ── ConnectionPanel ────────────────────────────────────────────────────────────

function ConnectionPanel({
  bidId,
  linkedProjectId,
  linkedProjectName,
  onLinked,
}: {
  bidId: number;
  linkedProjectId: string | null;
  linkedProjectName: string | null;
  onLinked: (id: string | null, name: string | null) => void;
}) {
  const [projects, setProjects] = useState<ProcoreProject[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(!linkedProjectId);
  const [linking, setLinking] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search(q: string) {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/procore/projects?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { projects?: ProcoreProject[]; error?: string };
      if (data.error) {
        setSearchError(data.error);
      } else {
        setProjects(data.projects ?? []);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSearching(false);
    }
  }

  async function linkProject(project: ProcoreProject) {
    setLinking(true);
    try {
      await fetch(`/api/bids/${bidId}/procore-project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procoreProjectId: String(project.id) }),
      });
      onLinked(String(project.id), project.name);
      setExpanded(false);
    } finally {
      setLinking(false);
    }
  }

  async function unlink() {
    setLinking(true);
    try {
      await fetch(`/api/bids/${bidId}/procore-project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procoreProjectId: null }),
      });
      onLinked(null, null);
      setProjects([]);
      setQuery("");
      setExpanded(true);
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-2.5">
          {linkedProjectId ? (
            <Link2 className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : (
            <Link2Off className="h-4 w-4 text-zinc-400 shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {linkedProjectId
                ? linkedProjectName ?? `Project ${linkedProjectId}`
                : "No Procore project linked"}
            </p>
            {linkedProjectId && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                ID {linkedProjectId} · Linked
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {linkedProjectId && (
            <button
              onClick={unlink}
              disabled={linking}
              className="text-xs text-zinc-500 hover:text-red-600 underline disabled:opacity-50 dark:text-zinc-400 dark:hover:text-red-400"
            >
              Unlink
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {expanded ? "Hide" : "Change"}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
            Search your Procore company for a project to link to this bid.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(query)}
              placeholder="Project name…"
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-400"
            />
            <button
              onClick={() => search(query)}
              disabled={searching}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
            </button>
          </div>

          {searchError && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {searchError}
            </div>
          )}

          {projects.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 max-h-48 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => linkProject(p)}
                  disabled={linking}
                  className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-zinc-400 hover:bg-white disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-500 dark:hover:bg-zinc-750"
                >
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {p.name}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {p.projectNumber ?? `#${p.id}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── PushCard ───────────────────────────────────────────────────────────────────

function PushCard({
  title,
  description,
  procorePath,
  rowCount,
  rowLabel,
  downloadUrl,
  downloadFallbackName,
  pushUrl,
  requiresProject,
  hasProject,
  emptyMessage,
  lastPush,
}: {
  title: string;
  description: string;
  procorePath: string;
  rowCount: number;
  rowLabel: string;
  downloadUrl: string;
  downloadFallbackName: string;
  pushUrl: string;
  requiresProject: boolean;
  hasProject: boolean;
  emptyMessage: string;
  lastPush: PushStatus | null;
}) {
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const isEmpty = rowCount === 0;
  const pushDisabled = isEmpty || (requiresProject && !hasProject);

  async function handleDownload() {
    setDownloadState("loading");
    setDownloadError(null);
    try {
      const err = await downloadCsv(downloadUrl, downloadFallbackName);
      if (err) {
        setDownloadError(err);
        setDownloadState("error");
      } else {
        setDownloadState("done");
        setTimeout(() => setDownloadState("idle"), 3000);
      }
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
      setDownloadState("error");
    }
  }

  async function handlePush() {
    setPushState("pushing");
    setPushResult(null);
    setPushError(null);
    setShowErrors(false);
    try {
      const res = await fetch(pushUrl, { method: "POST" });
      const data = (await res.json()) as PushResult & { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setPushError(data.error ?? `HTTP ${res.status}`);
        setPushState("error");
      } else {
        setPushResult(data);
        setPushState("done");
      }
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Network error");
      setPushState("error");
    }
  }

  const activeErrors = pushResult?.errors ?? [];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Procore: <span className="font-mono">{procorePath}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {isEmpty ? (
            <span className="text-xs text-zinc-400 italic dark:text-zinc-500">{emptyMessage}</span>
          ) : (
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {rowCount} {rowLabel}
            </span>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              disabled={isEmpty || downloadState === "loading"}
              title="Download CSV"
              className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {downloadState === "loading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              CSV
            </button>

            <button
              onClick={handlePush}
              disabled={pushDisabled || pushState === "pushing"}
              title={
                requiresProject && !hasProject
                  ? "Link a Procore project first"
                  : "Push to Procore"
              }
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {pushState === "pushing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pushState === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
              {pushState === "error" && <AlertCircle className="h-3.5 w-3.5" />}
              {pushState === "idle" && <ArrowUpFromLine className="h-3.5 w-3.5" />}
              {pushState === "pushing"
                ? "Pushing…"
                : pushState === "done"
                  ? "Pushed"
                  : "Push"}
            </button>
          </div>
        </div>
      </div>

      {pushState === "done" && pushResult && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-900/20">
          <div className="flex items-center justify-between">
            <div className="flex gap-4 text-xs text-emerald-700 dark:text-emerald-300">
              <span>{pushResult.created} created</span>
              {pushResult.updated > 0 && <span>{pushResult.updated} updated</span>}
              {pushResult.skipped > 0 && (
                <span className="text-zinc-500">{pushResult.skipped} skipped</span>
              )}
            </div>
            {activeErrors.length > 0 && (
              <button
                onClick={() => setShowErrors((s) => !s)}
                className="text-xs text-amber-700 underline dark:text-amber-400"
              >
                {activeErrors.length} {activeErrors.length === 1 ? "error" : "errors"}
              </button>
            )}
          </div>
          {showErrors && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
              {activeErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pushState === "error" && pushError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {pushError}
        </div>
      )}

      {downloadError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {downloadError}
        </div>
      )}

      {lastPush && pushState === "idle" && (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Last push {fmtDate(lastPush.pushedAt)} · {lastPush.created}c {lastPush.updated}u{" "}
          {lastPush.skipped}s
          {lastPush.errors.length > 0 && ` · ${lastPush.errors.length} errors`}
        </p>
      )}
    </div>
  );
}

// ── SchedulePushCard ───────────────────────────────────────────────────────────
//
// Tier F F4 — push/download the schedule as MSP XML.
// Push is async on Procore's side; we show the returned import ID.

type SchedulePushResult = {
  importId: number | null;
  status: string | null;
  activityCount: number;
  scheduleName: string;
  procoreErrors: string[];
};

function SchedulePushCard({
  bidId,
  activityCount,
  hasProject,
}: {
  bidId: number;
  activityCount: number;
  hasProject: boolean;
}) {
  const [dlState, setDlState] = useState<"idle" | "loading">("idle");
  const [dlError, setDlError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [pushResult, setPushResult] = useState<SchedulePushResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const isEmpty = activityCount === 0;
  const pushDisabled = isEmpty || !hasProject || pushState === "pushing";

  async function handleDownload() {
    setDlState("loading");
    setDlError(null);
    try {
      const err = await downloadCsv(
        `/api/bids/${bidId}/procore-push/schedule`,
        `schedule_bid${bidId}.xml`
      );
      if (err) setDlError(err);
    } catch (e) {
      setDlError(e instanceof Error ? e.message : String(e));
    } finally {
      setDlState("idle");
    }
  }

  async function handlePush() {
    setPushState("pushing");
    setPushResult(null);
    setPushError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/procore-push/schedule`, { method: "POST" });
      const data = (await res.json()) as SchedulePushResult & { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setPushError(data.error ?? `HTTP ${res.status}`);
        setPushState("error");
      } else {
        setPushResult(data);
        setPushState("done");
      }
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Network error");
      setPushState("error");
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Schedule
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Export the CPM schedule as MSP XML for import into Microsoft Project or Procore.
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Procore: <span className="font-mono">Project → Schedule</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {isEmpty ? (
            <span className="text-xs text-zinc-400 italic dark:text-zinc-500">No schedule yet</span>
          ) : (
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {activityCount} {activityCount === 1 ? "activity" : "activities"}
            </span>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              disabled={isEmpty || dlState === "loading"}
              title="Download MSP XML"
              className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {dlState === "loading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              XML
            </button>

            <button
              onClick={handlePush}
              disabled={pushDisabled}
              title={
                !hasProject
                  ? "Link a Procore project first"
                  : isEmpty
                    ? "No schedule activities"
                    : "Push to Procore"
              }
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {pushState === "pushing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pushState === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
              {pushState === "error" && <AlertCircle className="h-3.5 w-3.5" />}
              {pushState === "idle" && <ArrowUpFromLine className="h-3.5 w-3.5" />}
              {pushState === "pushing" ? "Pushing…" : pushState === "done" ? "Submitted" : "Push"}
            </button>
          </div>
        </div>
      </div>

      {pushState === "done" && pushResult && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-900/20">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Import submitted to Procore
            {pushResult.importId ? ` (ID ${pushResult.importId})` : ""}.
            {" "}Check{" "}
            <span className="font-medium">Project → Schedule</span> in Procore to confirm it processed.
          </p>
          {pushResult.procoreErrors?.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
              {pushResult.procoreErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {pushState === "error" && pushError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {pushError}
        </div>
      )}

      {dlError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {dlError}
        </div>
      )}
    </div>
  );
}

// ── SyncCard ───────────────────────────────────────────────────────────────────
//
// Pull-from-Procore card: a sync button + result summary + optional item list.

function SyncCard({
  title,
  description,
  procorePath,
  syncUrl,
  hasProject,
  children,
}: {
  title: string;
  description: string;
  procorePath: string;
  syncUrl: string;
  hasProject: boolean;
  children?: React.ReactNode;
}) {
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncResult, setSyncResult] = useState<PushResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  async function handleSync() {
    setSyncState("syncing");
    setSyncResult(null);
    setSyncError(null);
    setShowErrors(false);
    try {
      const res = await fetch(syncUrl, { method: "POST" });
      const data = (await res.json()) as PushResult & { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setSyncError(data.error ?? `HTTP ${res.status}`);
        setSyncState("error");
      } else {
        setSyncResult(data);
        setSyncState("done");
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Network error");
      setSyncState("error");
    }
  }

  const activeErrors = syncResult?.errors ?? [];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Procore: <span className="font-mono">{procorePath}</span>
          </p>
        </div>

        <button
          onClick={handleSync}
          disabled={!hasProject || syncState === "syncing"}
          title={!hasProject ? "Link a Procore project first" : "Pull from Procore"}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {syncState === "syncing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {syncState === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
          {syncState === "error" && <AlertCircle className="h-3.5 w-3.5" />}
          {syncState === "idle" && <ArrowDownToLine className="h-3.5 w-3.5" />}
          {syncState === "syncing" ? "Syncing…" : syncState === "done" ? "Synced" : "Sync"}
        </button>
      </div>

      {syncState === "done" && syncResult && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-900/20">
          <div className="flex items-center justify-between">
            <div className="flex gap-4 text-xs text-emerald-700 dark:text-emerald-300">
              {syncResult.created > 0 && <span>{syncResult.created} new</span>}
              {syncResult.updated > 0 && <span>{syncResult.updated} updated</span>}
              <span className="text-zinc-500">{syncResult.skipped} unchanged</span>
            </div>
            {activeErrors.length > 0 && (
              <button
                onClick={() => setShowErrors((s) => !s)}
                className="text-xs text-amber-700 underline dark:text-amber-400"
              >
                {activeErrors.length} {activeErrors.length === 1 ? "error" : "errors"}
              </button>
            )}
          </div>
          {showErrors && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
              {activeErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {syncState === "error" && syncError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {syncError}
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// ── RfiList ────────────────────────────────────────────────────────────────────

function RfiList({ bidId, refreshTick }: { bidId: number; refreshTick: number }) {
  const [rfis, setRfis] = useState<RfiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bids/${bidId}/rfis`)
      .then((r) => r.json() as Promise<{ rfis: RfiItem[] }>)
      .then((d) => setRfis(d.rfis ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bidId, refreshTick]);

  if (loading) return <p className="text-xs text-zinc-400 dark:text-zinc-500">Loading RFIs…</p>;
  if (rfis.length === 0)
    return (
      <p className="text-xs text-zinc-400 italic dark:text-zinc-500">
        No RFIs synced yet. Click Sync to pull from Procore.
      </p>
    );

  const open = rfis.filter((r) => r.status !== "closed" && r.status !== "draft");
  const closed = rfis.filter((r) => r.status === "closed" || r.status === "draft");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {open.length} open · {closed.length} closed · synced{" "}
          {rfis[0]?.syncedAt ? fmtDate(rfis[0].syncedAt) : "—"}
        </p>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {expanded ? "Hide list" : `Show ${rfis.length}`}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {rfis.map((rfi) => (
            <div
              key={rfi.id}
              className="flex items-start justify-between gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/40"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  <span className="text-zinc-400 dark:text-zinc-500 mr-1">RFI {rfi.number}</span>
                  {rfi.title}
                </p>
                {rfi.assigneeName && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    {rfi.assigneeName}
                    {rfi.dueDate && ` · Due ${fmtDate(rfi.dueDate)}`}
                  </p>
                )}
              </div>
              <span
                className={`text-xs font-medium shrink-0 capitalize ${rfiStatusColor(rfi.status)}`}
              >
                {rfi.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WebhookPanel ───────────────────────────────────────────────────────────────

function WebhookPanel({ credsMissing }: { credsMissing: boolean }) {
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (credsMissing) return;
    setLoadError(null);
    fetch("/api/procore/webhook/register")
      .then((r) => r.json() as Promise<WebhookStatus & { error?: string }>)
      .then((d) => {
        if (d.error) setLoadError(d.error);
        else setStatus(d);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Network error"));
  }, [credsMissing, reloadTick]);

  async function handleRegister() {
    setActionState("working");
    setActionError(null);
    try {
      const res = await fetch("/api/procore/webhook/register", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setActionError(data.error ?? `HTTP ${res.status}`);
        setActionState("error");
      } else {
        setActionState("done");
        setReloadTick((t) => t + 1);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error");
      setActionState("error");
    }
  }

  async function handleUnregister() {
    if (!status?.hookId) return;
    setActionState("working");
    setActionError(null);
    try {
      const res = await fetch("/api/procore/webhook/register", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hookId: status.hookId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setActionError(data.error ?? `HTTP ${res.status}`);
        setActionState("error");
      } else {
        setActionState("idle");
        setReloadTick((t) => t + 1);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error");
      setActionState("error");
    }
  }

  if (credsMissing) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Real-Time Webhook
            </h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Procore sends events to your app when RFIs are opened or submittals are updated.
            Requires a public HTTPS URL — set{" "}
            <a href="/settings?section=procore" className="underline hover:text-zinc-700 dark:hover:text-zinc-200">
              Webhook URL + Secret
            </a>{" "}
            in Settings first.
          </p>
        </div>

        <div className="shrink-0">
          {loadError ? (
            <span className="text-xs text-red-600 dark:text-red-400">{loadError}</span>
          ) : !status ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          ) : status.registered ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Registered
              </span>
              <button
                onClick={handleUnregister}
                disabled={actionState === "working"}
                className="text-xs text-zinc-500 hover:text-red-600 underline disabled:opacity-50 dark:text-zinc-400 dark:hover:text-red-400"
              >
                Unregister
              </button>
            </div>
          ) : (
            <button
              onClick={handleRegister}
              disabled={actionState === "working"}
              className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              {actionState === "working" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Register
            </button>
          )}
        </div>
      </div>

      {status?.registered && status.hookUrl && (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 font-mono truncate">
          {status.hookUrl}
        </p>
      )}

      {actionError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {actionError}
        </div>
      )}

      {!status?.registered && (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Without a webhook, use the Sync buttons above to pull updates manually.
          The manual pull is the recommended approach for local development.
        </p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProcoreTab({ bidId }: { bidId: number }) {
  const [stats, setStats] = useState<ProcoreStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [linkedProjectName, setLinkedProjectName] = useState<string | null>(null);
  const [pushStatuses, setPushStatuses] = useState<PushStatus[]>([]);
  const [credsMissing, setCredsMissing] = useState(false);
  const [rfiRefreshTick, setRfiRefreshTick] = useState(0);

  const loadStatus = useCallback(async () => {
    const res = await fetch(`/api/bids/${bidId}/procore-push/status`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      procoreProjectId: string | null;
      pushes: PushStatus[];
    };
    setLinkedProjectId(data.procoreProjectId);
    setPushStatuses(data.pushes);
  }, [bidId]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/bids/${bidId}/procore-export`).then(
        (r) => r.json() as Promise<ProcoreStats | { error: string }>
      ),
      fetch("/api/procore/test").then(
        (r) => r.json() as Promise<{ ok: boolean; error?: string }>
      ),
      loadStatus(),
    ])
      .then(([statsData, testData]) => {
        if ("error" in statsData) {
          setStatsError(statsData.error);
        } else {
          setStats(statsData);
        }
        setCredsMissing(!testData.ok);
      })
      .catch((e) => {
        setStatsError(e instanceof Error ? e.message : String(e));
      });
  }, [bidId, loadStatus]);

  function lastPushFor(type: string): PushStatus | null {
    return pushStatuses.find((p) => p.type === type) ?? null;
  }

  const hasProject = !!linkedProjectId;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Procore</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Push project data to Procore, pull RFIs and submittal status updates back.
          CSV export is always available; direct sync requires API credentials.
        </p>
      </div>

      {statsError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {statsError}
        </div>
      )}

      {/* ── Credentials missing banner ── */}
      {credsMissing && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-900/20">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 dark:text-amber-400" />
          <div className="flex-1 text-sm text-amber-800 dark:text-amber-300">
            Procore API credentials not configured. CSV export is still available.
          </div>
          <a
            href="/settings?section=procore"
            className="flex items-center gap-1 text-xs font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
          >
            <Settings className="h-3 w-3" />
            Settings
          </a>
        </div>
      )}

      {/* ── Project connection ── */}
      {!credsMissing && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
            Procore Project
          </p>
          <ConnectionPanel
            bidId={bidId}
            linkedProjectId={linkedProjectId}
            linkedProjectName={linkedProjectName}
            onLinked={(id, name) => {
              setLinkedProjectId(id);
              setLinkedProjectName(name);
            }}
          />
        </section>
      )}

      {/* ── Step 1 — Directory ── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
          Step 1 — Directory
        </p>
        <div className="flex flex-col gap-3">
          <PushCard
            title="Vendor Directory"
            description="All subcontractors invited or awarded on this project."
            procorePath="Admin → Directory → Companies"
            rowCount={stats?.vendors ?? 0}
            rowLabel={(stats?.vendors ?? 0) === 1 ? "company" : "companies"}
            downloadUrl={`/api/bids/${bidId}/procore-export/vendors`}
            downloadFallbackName="procore-vendors.csv"
            pushUrl={`/api/bids/${bidId}/procore-push/vendors`}
            requiresProject={false}
            hasProject={hasProject}
            emptyMessage="No subs added yet"
            lastPush={lastPushFor("vendors")}
          />
          <PushCard
            title="Project Contacts"
            description="Owner, architect, engineer, and internal team members."
            procorePath="Admin → Directory → People"
            rowCount={stats?.contacts ?? 0}
            rowLabel={(stats?.contacts ?? 0) === 1 ? "contact" : "contacts"}
            downloadUrl={`/api/bids/${bidId}/procore-export/contacts`}
            downloadFallbackName="procore-contacts.csv"
            pushUrl={`/api/bids/${bidId}/procore-push/contacts`}
            requiresProject={false}
            hasProject={hasProject}
            emptyMessage="No contacts added yet"
            lastPush={lastPushFor("contacts")}
          />
        </div>
      </section>

      {/* ── Step 2 — Budget ── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
          Step 2 — Budget
        </p>
        <PushCard
          title="Budget Lines"
          description={
            stats
              ? `${stats.budgetTradeLines} trade ${stats.budgetTradeLines === 1 ? "line" : "lines"} (subcontract) + ${stats.budgetGcLines} GC overhead.`
              : "Per-trade committed amounts plus GC overhead lines."
          }
          procorePath="Project → Budget"
          rowCount={(stats?.budgetTradeLines ?? 0) + (stats?.budgetGcLines ?? 0)}
          rowLabel="lines"
          downloadUrl={`/api/bids/${bidId}/procore-export/budget`}
          downloadFallbackName="procore-budget.csv"
          pushUrl={`/api/bids/${bidId}/procore-push/budget`}
          requiresProject={true}
          hasProject={hasProject}
          emptyMessage="No trades added yet"
          lastPush={lastPushFor("budget")}
        />
      </section>

      {/* ── Step 3 — Submittals ── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
          Step 3 — Submittal Log
        </p>
        <PushCard
          title="Submittal Log"
          description="Active submittal register items."
          procorePath="Project → Submittals"
          rowCount={stats?.submittals ?? 0}
          rowLabel={(stats?.submittals ?? 0) === 1 ? "submittal" : "submittals"}
          downloadUrl={`/api/bids/${bidId}/submittals/export`}
          downloadFallbackName="procore-submittals.csv"
          pushUrl={`/api/bids/${bidId}/procore-push/submittals`}
          requiresProject={true}
          hasProject={hasProject}
          emptyMessage="No submittals yet"
          lastPush={lastPushFor("submittals")}
        />
      </section>

      {/* ── Step 4 — Schedule ── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
          Step 4 — Schedule
        </p>
        <SchedulePushCard
          bidId={bidId}
          activityCount={stats?.scheduleActivities ?? 0}
          hasProject={hasProject}
        />
      </section>

      {/* ── Step 5 — Pull from Procore ── */}
      {!credsMissing && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
            Step 5 — Pull from Procore
          </p>
          <div className="flex flex-col gap-3">
            <SyncCard
              title="RFI Log"
              description="Pull all RFIs from the linked Procore project. New RFIs are added; existing ones are updated."
              procorePath="Project → RFIs"
              syncUrl={`/api/bids/${bidId}/procore-pull/rfis`}
              hasProject={hasProject}
            >
              <RfiList
                bidId={bidId}
                refreshTick={rfiRefreshTick}
              />
            </SyncCard>

            <SyncCard
              title="Submittal Status Sync"
              description="Fetch current submittal statuses from Procore and update your register. Matches by title."
              procorePath="Project → Submittals"
              syncUrl={`/api/bids/${bidId}/procore-pull/submittals`}
              hasProject={hasProject}
            />
          </div>
        </section>
      )}

      {/* ── Webhook setup ── */}
      {!credsMissing && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
            Webhook (Optional)
          </p>
          <WebhookPanel credsMissing={credsMissing} />
        </section>
      )}

      {/* ── Info ── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-800/40">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
          Import order matters
        </h3>
        <ol className="flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 list-decimal list-inside">
          <li>
            <strong>Vendor Directory</strong> first — Procore links subs to budget lines and
            submittals by company name.
          </li>
          <li>
            <strong>Project Contacts</strong> — available for assignment on RFIs, submittals, and
            daily logs.
          </li>
          <li>
            <strong>Budget Lines</strong> — cost codes must exist before submittals reference them.
          </li>
          <li>
            <strong>Submittal Log</strong> — Procore links submittals to companies and spec
            sections.
          </li>
          <li>
            <strong>Schedule</strong> — push the CPM baseline to Procore's scheduling module.
            Procore processes the import asynchronously.
          </li>
          <li>
            <strong>Pull RFIs</strong> — after construction begins, sync Procore RFIs back into
            this register.
          </li>
        </ol>
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Direct sync requires a linked Procore project and API credentials in{" "}
          <a
            href="/settings?section=procore"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Settings
          </a>
          .
        </p>
      </section>
    </div>
  );
}
