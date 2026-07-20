"use client";

import { useCallback, useEffect, useState } from "react";

type Task = {
  id: number;
  bidId: number;
  description: string;
  assignedToName: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  isGcTask: boolean;
  source: string;
  notes: string | null;
  meetingRef: { title: string; date: string | null } | null;
  createdAt: string;
};

const PRIORITY: Record<string, { color: string; bg: string; border: string }> = {
  CRITICAL: { color: "#ff968f",         bg: "var(--red-dim)",        border: "rgba(232,69,60,0.22)"  },
  HIGH:     { color: "#ffcc72",         bg: "var(--amber-dim)",      border: "rgba(245,166,35,0.2)"  },
  MEDIUM:   { color: "#b8ceff",         bg: "rgba(126,167,255,0.1)", border: "rgba(126,167,255,0.2)" },
  LOW:      { color: "var(--text-dim)", bg: "rgba(255,255,255,0.04)",border: "rgba(255,255,255,0.1)" },
};

const STATUS: Record<string, { color: string; bg: string; border: string; label: string }> = {
  OPEN:        { color: "var(--text-soft)",  bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  label: "OPEN" },
  IN_PROGRESS: { color: "#b8ceff",           bg: "rgba(126,167,255,0.1)",  border: "rgba(126,167,255,0.2)", label: "IN PROG" },
  COMPLETED:   { color: "var(--signal-soft)", bg: "var(--signal-dim)",     border: "rgba(45,123,255,0.22)",  label: "DONE" },
  DEFERRED:    { color: "var(--text-dim)",   bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", label: "DEFER" },
};

function fmtDue(s: string | null): { label: string; tone: "ok" | "soon" | "overdue" | "none" } {
  if (!s) return { label: "—", tone: "none" };
  const due = new Date(s);
  const now = new Date();
  const days = Math.floor((due.getTime() - now.getTime()) / 86_400_000);
  const label = due.toLocaleDateString();
  if (days < 0) return { label: `${label} (overdue)`, tone: "overdue" };
  if (days <= 7) return { label: `${label} (${days}d)`, tone: "soon" };
  return { label, tone: "ok" };
}

const inputCls =
  "rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-[rgba(45,123,255,0.4)]";
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "var(--text)" };

export default function TasksTab({ bidId }: { bidId: number }) {
  const [tasks, setTasks]   = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all" | "closed">("open");
  const [showNew, setShowNew] = useState(false);

  // New task draft
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const statusParam = filter === "all" ? "" : `?status=${filter}`;
    const sep = statusParam ? "&" : "?";
    const res = await fetch(`/api/tasks${statusParam}${sep}bidId=${bidId}`, { cache: "no-store" });
    const data = await res.json();
    setTasks(Array.isArray(data) ? data : data.tasks ?? []);
    setLoading(false);
  }, [bidId, filter]);

  useEffect(() => {
    const request = setTimeout(() => void load(), 0);
    return () => clearTimeout(request);
  }, [load]);

  async function createTask() {
    if (!desc.trim()) return;
    setSaving(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidId,
        description: desc.trim(),
        assignedToName: assignee.trim() || null,
        dueDate: dueDate || null,
        priority,
        source: "manual",
        isGcTask: true,
      }),
    });
    setDesc(""); setAssignee(""); setDueDate(""); setPriority("MEDIUM");
    setSaving(false);
    setShowNew(false);
    load();
  }

  async function toggleStatus(t: Task) {
    const next = t.status === "COMPLETED" ? "OPEN" : "COMPLETED";
    await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    load();
  }

  async function deleteTask(t: Task) {
    if (!confirm(`Delete action item "${t.description}"?`)) return;
    await fetch(`/api/tasks/${t.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-[700] tracking-[-0.03em]" style={{ color: "var(--text)" }}>Action Items</h2>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-soft)" }}>
            The project-wide execution queue — action items from meetings plus
            manually added work.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded overflow-hidden border border-[var(--line)]" style={{ background: "rgba(255,255,255,0.03)" }}>
            {(["open", "all", "closed"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5"
                style={{
                  color: filter === f ? "var(--signal)" : "var(--text-dim)",
                  background: filter === f ? "rgba(45,123,255,0.08)" : "transparent",
                }}>
                {f}
              </button>
            ))}
          </div>
          <button onClick={() => setShowNew(!showNew)}
            className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
            style={{
              color: showNew ? "var(--signal)" : "var(--text-dim)",
              border: `1px solid ${showNew ? "rgba(45,123,255,0.3)" : "var(--line)"}`,
              background: showNew ? "rgba(45,123,255,0.06)" : "transparent",
            }}>
            + Add Action Item
          </button>
        </div>
      </div>

      {showNew && (
        <div className="border border-[var(--line)] rounded-[var(--radius)] p-4 flex flex-col gap-2.5"
          style={{ background: "rgba(45,123,255,0.03)" }}>
          <input value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="What needs to be done?"
            className={inputCls} style={inputStyle} autoFocus />
          <div className="grid grid-cols-3 gap-2">
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)}
              placeholder="Assignee" className={inputCls} style={inputStyle} />
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className={inputCls} style={inputStyle} />
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className={inputCls} style={inputStyle}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowNew(false)} className="text-xs px-3 py-1 rounded" style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
              Cancel
            </button>
            <button onClick={createTask} disabled={saving || !desc.trim()}
              className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40 transition-colors"
              style={{ background: "var(--signal)", color: "#000" }}>
              {saving ? "Saving…" : "Add Action Item"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[12px]" style={{ color: "var(--text-dim)" }}>Loading…</p>
      ) : tasks.length === 0 ? (
        <div className="px-4 py-12 text-center text-[13px]" style={{ color: "var(--text-dim)" }}>
          No {filter !== "all" ? filter : ""} action items for this project.
        </div>
      ) : (
        <div className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
          style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["", "Action Item", "Assigned", "Priority", "Due", "Status", ""].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.09em] text-left border-b border-[var(--line)]"
                    style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const pri = PRIORITY[t.priority] ?? PRIORITY.MEDIUM;
                const st  = STATUS[t.status]    ?? STATUS.OPEN;
                const due = fmtDue(t.dueDate);
                const isDone = t.status === "COMPLETED";
                return (
                  <tr key={t.id} className="gwx-tr border-b border-[var(--line)] last:border-b-0">
                    <td className="px-3 py-3 w-[36px]">
                      <input type="checkbox" checked={isDone} onChange={() => toggleStatus(t)}
                        className="cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-[500]" style={{ color: isDone ? "var(--text-dim)" : "var(--text)", textDecoration: isDone ? "line-through" : "none" }}>
                        {t.description}
                      </p>
                      {t.source && t.source !== "manual" && (
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                          {t.source === "meeting" && t.meetingRef ? `from "${t.meetingRef.title}"` : `source: ${t.source}`}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                      {t.assignedToName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em]"
                        style={{ color: pri.color, background: pri.bg, border: `1px solid ${pri.border}` }}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px]"
                      style={{ color: due.tone === "overdue" ? "var(--red)" : due.tone === "soon" ? "#ffcc72" : "var(--text-dim)" }}>
                      {due.label}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.07em]"
                        style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => deleteTask(t)}
                        title="Delete action item"
                        className="font-mono text-[11px] px-2 py-1 rounded"
                        style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
