"use client";

// Phase 5C — Schedule V2 editable grid
//
// TanStack Table v8 with virtualized rows (@tanstack/react-virtual).
// Zustand store (useScheduleStore) is the local state buffer; cells commit
// on blur/Enter and PATCH /api/bids/[id]/schedule-v2/activities/[activityId].
// The server returns the recalculated full activity list on every save.
//
// Keyboard navigation: Tab / Shift+Tab move between editable cells.
// Ctrl+Z / Ctrl+Y for undo/redo (client-side history of server-confirmed states).

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useHotkeys } from "react-hotkeys-hook";
import { Plus, Trash2, Loader2, ChevronRight, ChevronDown } from "lucide-react";
import { useScheduleStore } from "../store/useScheduleStore";
import ScheduleIntelligencePanel from "./ScheduleIntelligencePanel";
import {
  formatPredecessors,
  parsePredecessorString,
} from "@/lib/services/schedule/scheduleV2Service";
import type { ActivityV2 } from "@/lib/services/schedule/scheduleV2Service";

// ── Types ─────────────────────────────────────────────────────────────────────

type GridMeta = {
  bidId: number;
  commitCell: (activityId: string, field: string, value: unknown) => Promise<void>;
};

// ── Editable cell ─────────────────────────────────────────────────────────────

type EditableCellProps = {
  value: string;
  activityId: string;
  field: string;
  meta: GridMeta;
  numeric?: boolean;
  placeholder?: string;
  indent?: number; // px indent for WBS level
};

function EditableCell({
  value,
  activityId,
  field,
  meta,
  numeric,
  placeholder,
  indent,
}: EditableCellProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const saving = useScheduleStore((s) => s.saving.has(activityId));

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function startEdit() {
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commit() {
    setEditing(false);
    if (draft === value) return;
    const parsed = numeric ? Number(draft) : draft;
    await meta.commitCell(activityId, field, parsed);
  }

  if (!editing) {
    return (
      <span
        className="block w-full cursor-text truncate px-1 py-0.5 hover:bg-white/10 rounded text-sm"
        style={indent ? { paddingLeft: `${indent}px` } : undefined}
        onDoubleClick={startEdit}
        title={value || placeholder}
      >
        {saving && field === "name" ? (
          <Loader2 className="inline w-3 h-3 mr-1 animate-spin opacity-50" />
        ) : null}
        {value || <span className="opacity-30">{placeholder}</span>}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      className="w-full bg-blue-950 border border-blue-400 rounded px-1 py-0.5 text-sm outline-none"
      style={indent ? { paddingLeft: `${indent}px` } : undefined}
      value={draft}
      type={numeric ? "number" : "text"}
      min={numeric ? 1 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { setEditing(false); setDraft(value); }
        if (e.key === "Tab") commit(); // let Tab propagate for cell navigation
      }}
    />
  );
}

// ── Date formatter ────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-slate-700 text-slate-300",
  in_progress: "bg-blue-700 text-blue-100",
  complete: "bg-green-700 text-green-100",
  on_hold: "bg-amber-700 text-amber-100",
};
const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  on_hold: "On Hold",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ScheduleGrid({ bidId }: { bidId: number }) {
  const { schedule, activities, deps, load, setActivities, snapshot, undo, redo, setSaving } =
    useScheduleStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // ── Load / init ───────────────────────────────────────────────────────────

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/schedule-v2`);
      if (res.status === 404) {
        // Create the schedule record
        const post = await fetch(`/api/bids/${bidId}/schedule-v2`, { method: "POST" });
        if (!post.ok) throw new Error(await post.text());
        const data = await post.json();
        load(data.schedule, data.activities, data.deps);
      } else if (!res.ok) {
        throw new Error(await res.text());
      } else {
        const data = await res.json();
        load(data.schedule, data.activities, data.deps);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [bidId, load]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  // ── Undo/redo hotkeys ─────────────────────────────────────────────────────

  useHotkeys("ctrl+z", (e) => { e.preventDefault(); undo(); }, { enableOnFormTags: false });
  useHotkeys("ctrl+y,ctrl+shift+z", (e) => { e.preventDefault(); redo(); }, { enableOnFormTags: false });

  // ── Cell commit ───────────────────────────────────────────────────────────

  const commitCell = useCallback(
    async (activityId: string, field: string, value: unknown) => {
      snapshot();
      setSaving(activityId, true);
      try {
        const body: Record<string, unknown> = { [field]: value };
        const res = await fetch(
          `/api/bids/${bidId}/schedule-v2/activities/${activityId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const data = await res.json();
        if (data.activities) setActivities(data.activities, deps);
      } catch (e) {
        console.error("commitCell error", e);
      } finally {
        setSaving(activityId, false);
      }
    },
    [bidId, snapshot, setSaving, setActivities, deps]
  );

  // ── Add row ───────────────────────────────────────────────────────────────

  const addActivity = useCallback(
    async (insertAfterSortOrder?: number) => {
      try {
        const res = await fetch(`/api/bids/${bidId}/schedule-v2/activities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Activity", insertAfterSortOrder }),
        });
        const data = await res.json();
        if (data.activities) setActivities(data.activities, deps);
      } catch (e) {
        console.error("addActivity error", e);
      }
    },
    [bidId, setActivities, deps]
  );

  // ── Delete row ────────────────────────────────────────────────────────────

  const deleteActivity = useCallback(
    async (activityId: string) => {
      snapshot();
      try {
        const res = await fetch(
          `/api/bids/${bidId}/schedule-v2/activities/${activityId}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.activities) setActivities(data.activities, deps);
      } catch (e) {
        console.error("deleteActivity error", e);
      }
    },
    [bidId, snapshot, setActivities, deps]
  );

  // ── Reload (used by ScheduleIntelligencePanel after seeding/generation) ──
  const reload = useCallback(() => loadSchedule(), [loadSchedule]);

  // ── Column definitions ────────────────────────────────────────────────────

  const columnHelper = createColumnHelper<ActivityV2>();

  const meta: GridMeta = { bidId, commitCell };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: ColumnDef<ActivityV2, any>[] = [
    columnHelper.display({
      id: "expander",
      size: 28,
      header: "",
      cell: ({ row }) => {
        const a = row.original;
        if (!a.isSummary) return null;
        const isCollapsed = collapsed.has(a.id);
        return (
          <button
            className="p-0.5 hover:text-white text-slate-400"
            onClick={() => {
              const next = new Set(collapsed);
              if (isCollapsed) next.delete(a.id);
              else next.add(a.id);
              setCollapsed(next);
            }}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        );
      },
    }),
    columnHelper.accessor("activityCode", {
      id: "activityCode",
      header: "ID",
      size: 72,
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-400 px-1">{getValue()}</span>
      ),
    }),
    columnHelper.accessor("name", {
      id: "name",
      header: "Activity Name",
      size: 280,
      cell: ({ row, getValue }) => {
        const a = row.original;
        const indent = (a.outlineLevel - 1) * 16 + 4;
        return (
          <EditableCell
            value={getValue() as string}
            activityId={a.id}
            field="name"
            meta={meta}
            indent={indent}
          />
        );
      },
    }),
    columnHelper.accessor("duration", {
      id: "duration",
      header: "Dur",
      size: 60,
      cell: ({ row, getValue }) => {
        const a = row.original;
        if (a.isMilestone) return <span className="text-xs text-slate-500 px-1">—</span>;
        return (
          <EditableCell
            value={String(getValue())}
            activityId={a.id}
            field="duration"
            meta={meta}
            numeric
          />
        );
      },
    }),
    columnHelper.accessor("startDate", {
      id: "startDate",
      header: "Start",
      size: 90,
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-300 px-1">{fmtDate(getValue() as string | null)}</span>
      ),
    }),
    columnHelper.accessor("finishDate", {
      id: "finishDate",
      header: "Finish",
      size: 90,
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-300 px-1">{fmtDate(getValue() as string | null)}</span>
      ),
    }),
    columnHelper.display({
      id: "predecessors",
      header: "Predecessors",
      size: 130,
      cell: ({ row }) => {
        const a = row.original;
        const predStr = formatPredecessors(a.id, deps, activities);
        return (
          <EditableCell
            value={predStr}
            activityId={a.id}
            field="predecessors"
            meta={meta}
            placeholder="e.g. A1010FS"
          />
        );
      },
    }),
    columnHelper.accessor("trade", {
      id: "trade",
      header: "Trade",
      size: 120,
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-400 px-1 truncate">{getValue() ?? ""}</span>
      ),
    }),
    columnHelper.accessor("status", {
      id: "status",
      header: "Status",
      size: 100,
      cell: ({ row, getValue }) => {
        const a = row.original;
        const status = getValue() as string;
        return (
          <select
            className={`text-xs rounded px-1 py-0.5 border-0 cursor-pointer ${STATUS_COLORS[status] ?? "bg-slate-700 text-slate-300"}`}
            value={status}
            onChange={(e) => commitCell(a.id, "status", e.target.value)}
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        );
      },
    }),
    columnHelper.accessor("notes", {
      id: "notes",
      header: "Notes",
      size: 180,
      cell: ({ row, getValue }) => (
        <EditableCell
          value={getValue() as string}
          activityId={row.original.id}
          field="notes"
          meta={meta}
          placeholder="Add note"
        />
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      size: 56,
      cell: ({ row }) => {
        const a = row.original;
        return (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="p-1 hover:text-blue-300 text-slate-500"
              title="Add row below"
              onClick={() => addActivity(a.sortOrder)}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1 hover:text-red-400 text-slate-500"
              title="Delete row"
              onClick={() => deleteActivity(a.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      },
    }),
  ];

  // ── Visible rows (collapse support) ──────────────────────────────────────

  const visibleActivities = React.useMemo(() => {
    if (collapsed.size === 0) return activities;
    const hiddenParents = new Set<string>();
    return activities.filter((a) => {
      if (collapsed.has(a.id)) { hiddenParents.add(a.id); return true; }
      if (a.isSummary) return true;
      // If any parent wbsId is collapsed, hide this row
      // Simple heuristic: if a summary with same wbsId prefix is collapsed, hide
      for (const hid of hiddenParents) {
        const parent = activities.find((p) => p.id === hid);
        if (parent && a.wbsId.startsWith(parent.wbsId + ".")) return false;
      }
      return true;
    });
  }, [activities, collapsed]);

  // ── TanStack Table ────────────────────────────────────────────────────────

  const table = useReactTable({
    data: visibleActivities,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  // ── Virtualizer ───────────────────────────────────────────────────────────

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading schedule…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        {error}
        <button className="ml-3 underline text-sm" onClick={loadSchedule}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Schedule Intelligence Panel */}
      <ScheduleIntelligencePanel bidId={bidId} onReload={reload} />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-900 flex-shrink-0">
        <button
          className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded transition-colors"
          onClick={() => addActivity()}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Activity
        </button>
        {schedule && (
          <span className="text-xs text-slate-500 ml-2">
            Start: {fmtDate(schedule.startDate)} · {activities.length} activities
          </span>
        )}
        <span className="ml-auto text-xs text-slate-600">
          Ctrl+Z undo · Ctrl+Y redo · Double-click to edit
        </span>
      </div>

      {/* Grid */}
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto"
        style={{ contain: "strict" }}
      >
        <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {table.getFlatHeaders().map((h) => (
              <col key={h.id} style={{ width: h.getSize() }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr>
              {table.getFlatHeaders().map((header) => (
                <th
                  key={header.id}
                  className="text-left text-xs font-medium text-slate-400 px-1 py-2 border-b border-slate-700 whitespace-nowrap"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ height: totalHeight, display: "block", position: "relative" }}>
            {virtualRows.map((vRow) => {
              const row = rows[vRow.index];
              const a = row.original;
              const isSummary = a.isSummary;
              return (
                <tr
                  key={row.id}
                  data-index={vRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={`group border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${isSummary ? "bg-slate-800/30 font-medium" : ""}`}
                  style={{
                    position: "absolute",
                    top: vRow.start,
                    left: 0,
                    width: "100%",
                    display: "table",
                    tableLayout: "fixed",
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-0.5 py-0.5 align-middle overflow-hidden"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {activities.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <p className="text-sm mb-1">No activities yet.</p>
            <p className="text-xs opacity-60">
              Use &ldquo;Build Skeleton&rdquo; or &ldquo;AI Schedule Intelligence&rdquo; above to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
