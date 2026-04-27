"use client";

// Module H4 — Schedule Seed UI
//
// New tab "Schedule" at position 12 on the bid detail page. Features:
//   - Project summary card (construction start date, total duration, activity counts)
//   - Seed from Trades / Recalculate / Export MSP CSV / Add Activity buttons
//   - Table: Activity ID | Name | Duration | Start | Finish | Predecessors
//     - Inline-editable duration (number input)
//     - Inline-editable predecessor IDs (text input, comma-separated)
//     - Delete button
//   - Milestones rendered with a distinct style
//
// Dates arrive as ISO strings from the server (with working-day math already
// applied) so the UI never has to compute them.
//
// Phase 5C: The full Schedule Builder (V2 grid with TanStack Table, undo/redo,
// predecessor string editing) lives at /bids/[id]/schedule. The banner below
// links there.

import Link from "next/link";
import { useEffect, useState } from "react";

// ── Types (mirror lib/services/schedule/scheduleService.ts) ────────────────

type ActivityKind = "CONSTRUCTION" | "MILESTONE";

type ActivityRow = {
  id: number;
  bidId: number;
  bidTradeId: number | null;
  tradeName: string | null;
  tradeCsiCode: string | null;
  activityId: string;
  name: string;
  kind: ActivityKind;
  sequence: number;
  durationDays: number;
  startDate: string | null;
  finishDate: string | null;
  predecessorIds: string[];
  notes: string | null;
};

type ProjectSummary = {
  bidId: number;
  constructionStartDate: string | null;
  projectDurationDays: number | null;
  computedStartDate: string | null;
  computedFinishDate: string | null;
  activityCount: number;
  constructionCount: number;
  milestoneCount: number;
};

type SeedResult = {
  tradesScanned: number;
  activitiesCreated: number;
  activitiesSkipped: number;
  milestonesCreated: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Main component ────────────────────────────────────────────────────────

export default function ScheduleTab({ bidId }: { bidId: number }) {
  const [activities, setActivities] = useState<ActivityRow[] | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [seeding, setSeeding] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [seedBanner, setSeedBanner] = useState<SeedResult | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/schedule`, { signal: controller.signal });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { activities: ActivityRow[]; summary: ProjectSummary };
        if (cancelled) return;
        setActivities(data.activities);
        setSummary(data.summary);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).name === "AbortError") {
          setError("Schedule load timed out");
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

  async function runSeed() {
    setSeeding(true);
    setError(null);
    setSeedBanner(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/schedule/seed`, { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as SeedResult;
      setSeedBanner(data);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function runRecalculate() {
    setRecalculating(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/schedule/recalculate`, { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecalculating(false);
    }
  }

  async function runExport() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/schedule/export`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Export failed: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : "schedule.csv";
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

  async function deleteActivity(rowId: number) {
    if (!confirm("Delete this activity?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/schedule/${rowId}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading schedule…</p>;
  }

  const hasStart = summary?.constructionStartDate != null;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Phase 5C: Schedule Builder banner ── */}
      <div className="flex items-center justify-between rounded-lg border border-blue-700/50 bg-blue-950/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-blue-300">Schedule Builder (Phase 5C)</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Full editable grid with undo/redo, predecessor chains, and WBS hierarchy.
          </p>
        </div>
        <Link
          href={`/bids/${bidId}/schedule`}
          className="rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 transition-colors whitespace-nowrap"
        >
          Open Schedule Builder →
        </Link>
      </div>

      {/* ── Header + Actions ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Project Schedule
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Starter schedule seeded from your trade list. Export to MS Project CSV for day 1.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={runSeed}
            disabled={seeding}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {seeding ? "Seeding…" : "Seed from Trades"}
          </button>
          <button
            onClick={runRecalculate}
            disabled={recalculating || !hasStart}
            title={!hasStart ? "Set a construction start date first (Job Intake on Overview tab)" : undefined}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {recalculating ? "Recalculating…" : "Recalculate Dates"}
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {showAddForm ? "Cancel Add" : "+ Add Activity"}
          </button>
          <button
            onClick={runExport}
            disabled={exporting || !activities || activities.length === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export MSP CSV"}
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── Seed result banner ── */}
      {seedBanner && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-900/30 dark:text-green-300">
          Scanned {seedBanner.tradesScanned} trades — created{" "}
          <strong>{seedBanner.activitiesCreated}</strong> construction activities
          {seedBanner.milestonesCreated > 0 &&
            ` + ${seedBanner.milestonesCreated} milestone${seedBanner.milestonesCreated === 1 ? "" : "s"}`}
          {seedBanner.activitiesSkipped > 0 && `, skipped ${seedBanner.activitiesSkipped} existing`}.
        </div>
      )}

      {/* ── Missing start date warning ── */}
      {!hasStart && activities && activities.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>No construction start date set.</strong> Activities have no dates yet.
          Add a construction start date in <em>Job Intake</em> (Overview tab) to hydrate start/finish dates.
        </div>
      )}

      {/* ── Project summary card ── */}
      {summary && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryStat
              label="Construction Start"
              value={fmtDate(summary.constructionStartDate)}
            />
            <SummaryStat
              label="Substantial Completion"
              value={fmtDate(summary.computedFinishDate)}
            />
            <SummaryStat
              label="Total Duration"
              value={summary.projectDurationDays != null ? `${summary.projectDurationDays} working days` : "—"}
            />
            <SummaryStat
              label="Activities"
              value={`${summary.constructionCount} construction · ${summary.milestoneCount} milestones`}
            />
          </div>
        </section>
      )}

      {/* ── Add form ── */}
      {showAddForm && (
        <AddActivityForm
          bidId={bidId}
          onCreated={() => {
            setShowAddForm(false);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {/* ── Table ── */}
      {activities && activities.length === 0 ? (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No activities yet. Click <strong>Seed from Trades</strong> to build a canonical construction
            schedule from your bid&apos;s trade list, or add one manually.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-3 py-2.5 w-20">ID</th>
                <th className="px-3 py-2.5">Activity</th>
                <th className="px-3 py-2.5 w-24">Duration</th>
                <th className="px-3 py-2.5 w-28">Start</th>
                <th className="px-3 py-2.5 w-28">Finish</th>
                <th className="px-3 py-2.5 w-36">Predecessors</th>
                <th className="px-2 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {activities?.map((a) => (
                <ScheduleRow
                  key={a.id}
                  bidId={bidId}
                  activity={a}
                  onSaved={() => setReloadTick((t) => t + 1)}
                  onDelete={() => deleteActivity(a.id)}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ── Summary stat ──────────────────────────────────────────────────────────

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className="text-sm font-semibold text-zinc-900 mt-0.5 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────

function ScheduleRow({
  bidId,
  activity,
  onSaved,
  onDelete,
}: {
  bidId: number;
  activity: ActivityRow;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [duration, setDuration] = useState(String(activity.durationDays));
  const [predecessors, setPredecessors] = useState(activity.predecessorIds.join(","));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reseed when activity refreshes
  useEffect(() => {
    setDuration(String(activity.durationDays));
    setPredecessors(activity.predecessorIds.join(","));
  }, [activity]);

  const isDirty =
    duration !== String(activity.durationDays) ||
    predecessors !== activity.predecessorIds.join(",");
  const isMilestone = activity.kind === "MILESTONE";

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const parsedDuration = parseInt(duration, 10);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
        throw new Error("Duration must be a non-negative number");
      }
      const res = await fetch(`/api/bids/${bidId}/schedule/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationDays: parsedDuration,
          predecessorIds: predecessors.trim() || null,
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
    <tr className={isMilestone ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}>
      <td className="px-3 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {activity.activityId}
      </td>
      <td className="px-3 py-2.5">
        <div className={`font-medium ${isMilestone ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-800 dark:text-zinc-100"}`}>
          {isMilestone && <span className="mr-1">◆</span>}
          {activity.name}
        </div>
        {activity.tradeCsiCode && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {activity.tradeCsiCode}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        {isMilestone ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">—</span>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-12 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">d</span>
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 tabular-nums">
        {fmtDate(activity.startDate)}
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 tabular-nums">
        {fmtDate(activity.finishDate)}
      </td>
      <td className="px-3 py-2.5">
        <input
          type="text"
          value={predecessors}
          onChange={(e) => setPredecessors(e.target.value)}
          placeholder="A1010,A1020"
          className="w-full rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1 justify-end">
          {isDirty && (
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "…" : "Save"}
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm leading-none"
            title="Delete activity"
          >
            ×
          </button>
        </div>
        {err && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{err}</p>}
      </td>
    </tr>
  );
}

// ── Add form ──────────────────────────────────────────────────────────────

function AddActivityForm({
  bidId,
  onCreated,
}: {
  bidId: number;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [durationDays, setDurationDays] = useState("5");
  const [predecessorIds, setPredecessorIds] = useState("");
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
      const parsedDuration = parseInt(durationDays, 10);
      const res = await fetch(`/api/bids/${bidId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          durationDays: Number.isFinite(parsedDuration) ? parsedDuration : 5,
          predecessorIds: predecessorIds.trim() || null,
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
        Add Activity
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Activity Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Temporary power hookup"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Duration (working days)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
            Predecessor IDs (optional, comma-separated)
          </label>
          <input
            value={predecessorIds}
            onChange={(e) => setPredecessorIds(e.target.value)}
            placeholder="A1010,A1020"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex justify-end mt-3">
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add Activity"}
        </button>
      </div>
    </section>
  );
}
