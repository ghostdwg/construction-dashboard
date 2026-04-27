"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

type Task = {
  id: number;
  bidId: number;
  meetingId: number | null;
  source: string;
  description: string;
  assignedToName: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  isGcTask: boolean;
  notes: string | null;
  sourceText: string | null;
  createdAt: string;
  project: { id: number; name: string; location: string | null };
  meetingRef: { title: string; date: string | null } | null;
  meeting: { id: number; title: string; meetingDate: string | null } | null;
};

type FilterStatus = "open" | "all" | "closed" | "deferred";
type ViewMode = "register" | "calendar";

// ── Chip config ────────────────────────────────────────────────────────────────

const PRIORITY_CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: "CRITICAL", color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"  },
  HIGH:     { label: "HIGH",     color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"  },
  MEDIUM:   { label: "MEDIUM",   color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)" },
  LOW:      { label: "LOW",      color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)" },
};

const STATUS_CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  OPEN:        { label: "OPEN",        color: "var(--text-soft)",   bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)"  },
  IN_PROGRESS: { label: "IN PROGRESS", color: "#ffcc72",            bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)"   },
  CLOSED:      { label: "CLOSED",      color: "var(--signal-soft)", bg: "var(--signal-dim)",      border: "rgba(0,255,100,0.22)"   },
  DEFERRED:    { label: "DEFERRED",    color: "var(--text-dim)",    bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)" },
};

const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "CLOSED" || status === "DEFERRED") return false;
  return new Date(dueDate) < new Date();
}

function startOfWeek(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay()); // Sunday
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PriorityChip({ priority }: { priority: string }) {
  const chip = PRIORITY_CHIP[priority] ?? PRIORITY_CHIP.MEDIUM;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
    >
      {chip.label}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] ?? STATUS_CHIP.OPEN;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
    >
      {chip.label}
    </span>
  );
}

function SourceChip({ source }: { source: string }) {
  const isMeeting = source === "meeting";

  return (
    <span
      className="font-mono text-[9px] uppercase tracking-[0.06em] px-2 py-0.5 rounded"
      style={{
        color: isMeeting ? "var(--text)" : "var(--blue)",
        background: isMeeting
          ? "color-mix(in srgb, var(--text-dim) 35%, transparent)"
          : "color-mix(in srgb, var(--blue) 14%, transparent)",
        border: `1px solid ${isMeeting ? "var(--line-strong)" : "var(--blue)"}`,
      }}
    >
      {isMeeting ? "meeting" : source}
    </span>
  );
}

// ── Status cycle button ────────────────────────────────────────────────────────
const STATUS_CYCLE: Record<string, string> = {
  OPEN: "IN_PROGRESS", IN_PROGRESS: "CLOSED", CLOSED: "OPEN", DEFERRED: "OPEN",
};

function CycleButton({ task, onCycled }: { task: Task; onCycled: () => void }) {
  const [busy, setBusy] = useState(false);
  async function cycle() {
    setBusy(true);
    const next = STATUS_CYCLE[task.status] ?? "OPEN";
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onCycled();
    setBusy(false);
  }
  return (
    <button
      onClick={cycle}
      disabled={busy}
      className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-2.5 py-1 rounded transition-colors disabled:opacity-40"
      style={{ border: "1px solid var(--line)" }}
    >
      {busy ? "…" : STATUS_CYCLE[task.status] === "CLOSED" ? "Close" : STATUS_CYCLE[task.status] === "IN_PROGRESS" ? "Start" : "Reopen"}
    </button>
  );
}

// ── Add Task form ──────────────────────────────────────────────────────────────

type Project = { id: number; name: string };

function AddTaskForm({
  projects,
  onCreated,
  onCancel,
}: {
  projects: Project[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [bidId, setBidId] = useState(projects[0]?.id ?? 0);
  const [description, setDescription] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { setError("Description required"); return; }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidId,
        description: description.trim(),
        assignedToName: assignedToName.trim() || null,
        dueDate: dueDate || null,
        priority,
        notes: notes.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Failed to create task");
      setSaving(false);
      return;
    }
    onCreated();
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[var(--radius)] border border-[var(--line)] p-4 flex flex-col gap-3"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.09em]" style={{ color: "var(--text-dim)" }}>
        New Manual Task
      </p>
      {error && <p className="text-[11px]" style={{ color: "#ff968f" }}>{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block font-mono text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-dim)" }}>
            Description *
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--signal)]"
            style={{ background: "rgba(255,255,255,0.03)", color: "var(--text)" }}
            placeholder="What needs to be done?"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-dim)" }}>
            Project *
          </label>
          <select
            value={bidId}
            onChange={e => setBidId(Number(e.target.value))}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--signal)]"
            style={{ background: "rgba(14,17,23,0.98)", color: "var(--text)" }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-dim)" }}>
            Priority
          </label>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--signal)]"
            style={{ background: "rgba(14,17,23,0.98)", color: "var(--text)" }}
          >
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-dim)" }}>
            Assigned To
          </label>
          <input
            type="text"
            value={assignedToName}
            onChange={e => setAssignedToName(e.target.value)}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--signal)]"
            style={{ background: "rgba(255,255,255,0.03)", color: "var(--text)" }}
            placeholder="Name"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-dim)" }}>
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--signal)]"
            style={{ background: "rgba(255,255,255,0.03)", color: "var(--text)" }}
          />
        </div>
        <div className="col-span-2">
          <label className="block font-mono text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: "var(--text-dim)" }}>
            Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--signal)]"
            style={{ background: "rgba(255,255,255,0.03)", color: "var(--text)" }}
            placeholder="Optional notes"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded border border-[var(--line)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors disabled:opacity-50"
          style={{ background: "var(--signal)", color: "#061009", fontWeight: 700 }}
        >
          {saving ? "Creating…" : "Create Task"}
        </button>
      </div>
    </form>
  );
}

// ── Calendar view ──────────────────────────────────────────────────────────────

function CalendarView({ tasks }: { tasks: Task[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekSun = startOfWeek(today);

  // Build 5-week grid (35 days)
  const days = Array.from({ length: 35 }, (_, i) => {
    const d = new Date(weekSun);
    d.setDate(weekSun.getDate() + i);
    return d;
  });

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Bucket tasks by day (ISO date key YYYY-MM-DD)
  const tasksByDay = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const key = new Date(task.dueDate).toISOString().slice(0, 10);
    if (!tasksByDay.has(key)) tasksByDay.set(key, []);
    tasksByDay.get(key)!.push(task);
  }

  // Overdue (due before today, still open)
  const overdue = tasks.filter(t => isOverdue(t.dueDate, t.status));

  return (
    <div className="flex flex-col gap-4">
      {overdue.length > 0 && (
        <div
          className="rounded-[var(--radius)] border p-4"
          style={{ borderColor: "rgba(232,69,60,0.3)", background: "rgba(232,69,60,0.04)" }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.09em] mb-3" style={{ color: "#ff968f" }}>
            Overdue — {overdue.length} item{overdue.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-col gap-1.5">
            {overdue.slice(0, 8).map(t => (
              <div key={t.id} className="flex items-center gap-3">
                <span className="font-mono text-[10px]" style={{ color: "#ff968f" }}>{fmtShort(t.dueDate)}</span>
                <span className="text-[12px] flex-1" style={{ color: "var(--text-soft)" }}>{t.description}</span>
                <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>{t.assignedToName ?? "—"}</span>
                <PriorityChip priority={t.priority} />
              </div>
            ))}
            {overdue.length > 8 && (
              <p className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>+{overdue.length - 8} more</p>
            )}
          </div>
        </div>
      )}

      {/* Calendar grid */}
      <div
        className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
        style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))" }}
      >
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-[var(--line)]">
          {DAY_LABELS.map(d => (
            <div key={d} className="px-2 py-2 border-r border-[var(--line)] last:border-r-0">
              <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-center" style={{ color: "var(--text-dim)" }}>{d}</p>
            </div>
          ))}
        </div>

        {/* 5-week rows */}
        {Array.from({ length: 5 }, (_, week) => (
          <div key={week} className="grid grid-cols-7 border-b border-[var(--line)] last:border-b-0">
            {days.slice(week * 7, week * 7 + 7).map((day, i) => {
              const key = day.toISOString().slice(0, 10);
              const dayTasks = tasksByDay.get(key) ?? [];
              const isToday = day.getTime() === today.getTime();
              const isPast = day < today;
              const isCurrentMonth = day.getMonth() === today.getMonth();

              return (
                <div
                  key={i}
                  className="min-h-[80px] p-2 border-r border-[var(--line)] last:border-r-0 flex flex-col gap-1"
                  style={{ background: isToday ? "rgba(0,255,100,0.03)" : "transparent" }}
                >
                  <p
                    className="font-mono text-[10px] font-[700] text-right"
                    style={{
                      color: isToday
                        ? "var(--signal-soft)"
                        : isPast
                        ? "var(--text-dim)"
                        : isCurrentMonth
                        ? "var(--text-soft)"
                        : "rgba(255,255,255,0.15)",
                    }}
                  >
                    {day.getDate()}
                  </p>
                  {dayTasks.slice(0, 3).map(t => {
                    const over = isOverdue(t.dueDate, t.status);
                    const pChip = PRIORITY_CHIP[t.priority] ?? PRIORITY_CHIP.MEDIUM;
                    return (
                      <div
                        key={t.id}
                        className="rounded px-1.5 py-0.5 text-[10px] leading-tight truncate"
                        style={{
                          background: over ? "rgba(232,69,60,0.1)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${over ? "rgba(232,69,60,0.2)" : "rgba(255,255,255,0.06)"}`,
                          color: over ? "#ff968f" : pChip.color,
                        }}
                        title={t.description}
                      >
                        {t.description.slice(0, 28)}{t.description.length > 28 ? "…" : ""}
                      </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <p className="font-mono text-[9px]" style={{ color: "var(--text-dim)" }}>
                      +{dayTasks.length - 3}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("register");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("open");
  const [filterProject, setFilterProject] = useState<number | "all">("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    setLoading(true);
    const statusParam = filterStatus === "open" ? "" : filterStatus === "all" ? "?status=all" : `?status=${filterStatus}`;
    const projectParam = filterProject !== "all" ? `${statusParam ? "&" : "?"}bidId=${filterProject}` : "";
    const url = `/api/tasks${statusParam}${projectParam}`;

    fetch(url)
      .then(r => r.json())
      .then((data: Task[]) => { setTasks(data); setError(null); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filterStatus, filterProject, reloadTick]);

  // Load projects for the add-task form
  useEffect(() => {
    fetch("/api/bids")
      .then(r => r.json())
      .then((data: { id: number; projectName: string }[]) => {
        setProjects(data.map(b => ({ id: b.id, name: b.projectName })));
      })
      .catch(() => {/* non-critical */});
  }, []);

  const sorted = [...tasks].sort((a, b) => {
    const aOver = isOverdue(a.dueDate, a.status) ? 0 : 1;
    const bOver = isOverdue(b.dueDate, b.status) ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    return 0;
  });

  const overdueCount = tasks.filter(t => isOverdue(t.dueDate, t.status)).length;
  const openCount    = tasks.filter(t => t.status === "OPEN").length;
  const inProgCount  = tasks.filter(t => t.status === "IN_PROGRESS").length;
  const manualCount  = tasks.filter(t => t.source === "manual").length;

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-6 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            groundworx // tasks
          </p>
          <h1 className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>
            Tasks
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
            Action items + manual tasks across all projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div
            className="flex rounded-md border border-[var(--line)] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            {(["register", "calendar"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 transition-colors"
                style={{
                  color: view === v ? "#061009" : "var(--text-dim)",
                  background: view === v ? "var(--signal)" : "transparent",
                  fontWeight: view === v ? 700 : 400,
                }}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded border border-[var(--line)] transition-colors hover:border-[var(--signal)]"
            style={{ color: showAddForm ? "var(--signal-soft)" : "var(--text-soft)" }}
          >
            {showAddForm ? "Cancel" : "+ Task"}
          </button>
        </div>
      </div>

      {/* ── Metric strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 px-6 py-5">
        {[
          { label: "Total",      value: tasks.length, accent: "var(--signal)"  },
          { label: "Overdue",    value: overdueCount,  accent: overdueCount > 0 ? "var(--red)" : "var(--text-dim)" },
          { label: "In Progress", value: inProgCount,  accent: inProgCount  > 0 ? "var(--amber)" : "var(--text-dim)" },
          { label: "Manual",     value: manualCount,   accent: "var(--blue)"   },
        ].map(({ label, value, accent }) => (
          <div
            key={label}
            className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--line)] px-4 py-4"
            style={{ background: "linear-gradient(180deg,rgba(19,23,30,0.94),rgba(14,17,23,0.96))" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: accent }} />
            <p className="font-mono text-[10px] uppercase tracking-[0.09em] mb-2" style={{ color: "var(--text-dim)" }}>{label}</p>
            <p className="text-[34px] font-[800] tracking-[-0.05em] leading-none" style={{ color: "var(--text)" }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="px-6 pb-6 flex flex-col gap-4">

        {/* ── Filter bar ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status filters */}
          <div className="flex gap-1">
            {([
              { key: "open",     label: "Open" },
              { key: "all",      label: "All" },
              { key: "closed",   label: "Closed" },
              { key: "deferred", label: "Deferred" },
            ] as { key: FilterStatus; label: string }[]).map(f => (
              <button
                key={f.key}
                onClick={() => setFilterStatus(f.key)}
                className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded border transition-colors"
                style={{
                  borderColor: filterStatus === f.key ? "var(--signal)" : "var(--line)",
                  color: filterStatus === f.key ? "var(--signal-soft)" : "var(--text-dim)",
                  background: filterStatus === f.key ? "rgba(0,255,100,0.06)" : "transparent",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Project filter */}
          {projects.length > 1 && (
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="rounded-md border border-[var(--line)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] focus:outline-none focus:border-[var(--signal)]"
              style={{ background: "rgba(14,17,23,0.98)", color: "var(--text-dim)" }}
            >
              <option value="all">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
            {loading ? "loading…" : `${sorted.length} item${sorted.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error && (
          <div
            className="rounded-[var(--radius)] border px-4 py-3 text-sm"
            style={{ borderColor: "rgba(232,69,60,0.3)", background: "rgba(232,69,60,0.05)", color: "#ff968f" }}
          >
            {error}
          </div>
        )}

        {/* ── Add form ──────────────────────────────────────────────────────── */}
        {showAddForm && (
          <AddTaskForm
            projects={projects}
            onCreated={() => { setShowAddForm(false); reload(); }}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {/* ── Views ─────────────────────────────────────────────────────────── */}
        {view === "calendar" ? (
          <CalendarView tasks={sorted} />
        ) : (
          /* Register view */
          <div
            className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
            style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))" }}
          >
            {loading ? (
              <div className="px-4 py-10 text-center">
                <p className="font-mono text-[11px]" style={{ color: "var(--text-dim)" }}>Loading tasks…</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-[500]" style={{ color: "var(--signal-soft)" }}>
                  {filterStatus === "open" ? "All clear — no open tasks." : "No tasks match these filters."}
                </p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
                  Create a manual task with + Task, or action items appear here after meeting analysis.
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Project", "Task", "Assigned To", "Source", "Due Date", "Priority", "Status", ""].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)]"
                        style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(task => {
                    const over = isOverdue(task.dueDate, task.status);
                    return (
                      <tr key={task.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                        {/* Project */}
                        <td className="px-4 py-3">
                          <Link
                            href={`/bids/${task.project.id}?tab=meetings`}
                            className="text-[12px] font-[600] transition-colors hover:text-emerald-400 block truncate max-w-[130px]"
                            style={{ color: "var(--text)" }}
                          >
                            {task.project.name}
                          </Link>
                          {task.project.location && (
                            <p className="text-[10px] mt-0.5 truncate max-w-[130px]" style={{ color: "var(--text-dim)" }}>
                              {task.project.location}
                            </p>
                          )}
                        </td>

                        {/* Task description */}
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="text-[12px] leading-snug" style={{ color: "var(--text)" }}>
                            {task.description}
                          </p>
                          {task.source === "meeting" && task.meetingRef && (
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-dim)" }}>
                              {task.meetingRef.title}
                              {task.meetingRef.date ? ` // ${fmtShort(task.meetingRef.date)}` : ""}
                            </p>
                          )}
                        </td>

                        {/* Assignee */}
                        <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text-soft)" }}>
                          {task.assignedToName ?? <span style={{ color: "var(--text-dim)" }}>—</span>}
                        </td>

                        {/* Source */}
                        <td className="px-4 py-3">
                          <SourceChip source={task.source} />
                        </td>

                        {/* Due date */}
                        <td className="px-4 py-3">
                          <span className="font-mono text-[11px]" style={{ color: over ? "#ff968f" : "var(--text-soft)" }}>
                            {fmtDate(task.dueDate)}
                            {over && <span className="ml-1 text-[9px]">▲</span>}
                          </span>
                        </td>

                        {/* Priority */}
                        <td className="px-4 py-3">
                          <PriorityChip priority={task.priority} />
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusChip status={task.status} />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <CycleButton task={task} onCycled={reload} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
