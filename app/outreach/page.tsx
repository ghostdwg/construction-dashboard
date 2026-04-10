"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Types ----

type OutreachLog = {
  id: number;
  bidId: number;
  subcontractorId: number | null;
  contactId: number | null;
  questionId: number | null;
  channel: string | null;
  status: string;
  sentAt: string | null;
  respondedAt: string | null;
  responseNotes: string | null;
  followUpDue: string | null;
  createdAt: string;
  updatedAt: string;
  bid: { projectName: string } | null;
  subcontractor: { company: string } | null;
  contact: { name: string; email: string | null } | null;
  question: { tradeName: string | null; questionText: string } | null;
};

// ---- Constants ----

const STATUSES = ["exported", "sent", "responded", "declined", "needs_follow_up"];

const STATUS_LABELS: Record<string, string> = {
  exported: "Exported",
  sent: "Sent",
  responded: "Responded",
  declined: "Declined",
  needs_follow_up: "Needs Follow-up",
};

const STATUS_COLORS: Record<string, string> = {
  exported: "bg-zinc-100 text-zinc-600",
  sent: "bg-blue-100 text-blue-700",
  responded: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
  needs_follow_up: "bg-amber-100 text-amber-700",
};

// ---- Helpers ----

function lastActivity(log: OutreachLog): string {
  const candidates = [log.respondedAt, log.sentAt, log.updatedAt, log.createdAt]
    .filter(Boolean) as string[];
  const latest = candidates.reduce((a, b) => (a > b ? a : b));
  return new Date(latest).toLocaleDateString();
}

function tradeName(log: OutreachLog): string {
  return log.question?.tradeName ?? "—";
}

// ---- Summary card ----

function SummaryCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-md border border-zinc-200 px-4 py-3 text-center">
      <p className="text-2xl font-semibold">{count}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

// ---- Expanded row ----

function ExpandedRow({
  log,
  onSave,
}: {
  log: OutreachLog;
  onSave: (id: number, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(log.responseNotes ?? "");
  const [followUp, setFollowUp] = useState(
    log.followUpDue ? log.followUpDue.slice(0, 10) : ""
  );
  const [saving, setSaving] = useState(false);

  async function save(extra?: Record<string, unknown>) {
    setSaving(true);
    await onSave(log.id, {
      responseNotes: notes,
      followUpDue: followUp || null,
      ...extra,
    });
    setSaving(false);
  }

  return (
    <tr className="bg-zinc-50">
      <td colSpan={7} className="px-4 py-4">
        <div className="flex flex-col gap-3 max-w-2xl">
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Notes</label>
            <textarea
              className="w-full text-sm bg-white border border-zinc-300 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-600 block mb-1">
                Follow-up Due
              </label>
              <input
                type="date"
                className="text-sm bg-white border border-zinc-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
            </div>
            <button
              onClick={() => save()}
              disabled={saving}
              className="mt-4 text-sm px-3 py-1.5 rounded bg-black text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {STATUSES.filter((s) => s !== log.status).map((s) => (
              <button
                key={s}
                onClick={() => save({ status: s })}
                className="text-xs px-2.5 py-1 rounded border border-zinc-200 hover:bg-zinc-100"
              >
                → {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---- Main page ----

export default function OutreachPage() {
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterBid, setFilterBid] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterSearch) params.set("search", filterSearch);
      const res = await fetch(`/api/outreach?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLogs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSearch]);

  useEffect(() => { load(); }, [load]);

  // Derive bid options from loaded data
  const bidOptions = Array.from(
    new Map(logs.map((l) => [l.bidId, l.bid?.projectName ?? `Bid ${l.bidId}`]))
  );

  // Client-side bid filter (avoids extra API param complexity)
  const filtered = filterBid
    ? logs.filter((l) => String(l.bidId) === filterBid)
    : logs;

  // Summary counts
  const counts: Record<string, number> = { total: filtered.length };
  for (const s of STATUSES) counts[s] = filtered.filter((l) => l.status === s).length;

  async function handleSave(id: number, patch: Record<string, unknown>) {
    const res = await fetch(`/api/outreach/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const updated: OutreachLog = await res.json();
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...updated } : l)));
    setExpandedId(null);
  }

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold mb-6">Outreach</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <div>
          <label className="text-xs font-medium text-zinc-600 block mb-1">Bid</label>
          <select
            className="text-sm bg-white border border-zinc-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={filterBid}
            onChange={(e) => setFilterBid(e.target.value)}
          >
            <option value="">All bids</option>
            {bidOptions.map(([id, name]) => (
              <option key={id} value={String(id)}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-600 block mb-1">Status</label>
          <select
            className="text-sm bg-white border border-zinc-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-600 block mb-1">Company</label>
          <input
            type="text"
            placeholder="Search company…"
            className="text-sm bg-white border border-zinc-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-44"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
          />
        </div>
        {(filterBid || filterStatus || filterSearch) && (
          <button
            onClick={() => { setFilterBid(""); setFilterStatus(""); setFilterSearch(""); }}
            className="text-xs text-zinc-500 hover:text-zinc-800 mt-4"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-8">
        <SummaryCard label="Total" count={counts.total} />
        <SummaryCard label="Exported" count={counts.exported ?? 0} />
        <SummaryCard label="Sent" count={counts.sent ?? 0} />
        <SummaryCard label="Responded" count={counts.responded ?? 0} />
        <SummaryCard label="Declined" count={counts.declined ?? 0} />
        <SummaryCard label="Needs Follow-up" count={counts.needs_follow_up ?? 0} />
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">No outreach logs found.</p>
      ) : (
        <div className="rounded-md border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Trade</th>
                <th className="px-4 py-2.5">Company</th>
                <th className="px-4 py-2.5">Contact</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Last Activity</th>
                <th className="px-4 py-2.5">Follow-up Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((log) => (
                <>
                  <tr
                    key={log.id}
                    className="hover:bg-zinc-50 cursor-pointer"
                    onClick={() =>
                      setExpandedId(expandedId === log.id ? null : log.id)
                    }
                  >
                    <td className="px-4 py-3">
                      {log.bid?.projectName ?? `Bid ${log.bidId}`}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{tradeName(log)}</td>
                    <td className="px-4 py-3">
                      {log.subcontractor?.company ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {log.contact?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                          STATUS_COLORS[log.status] ?? "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {STATUS_LABELS[log.status] ?? log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{lastActivity(log)}</td>
                    <td className="px-4 py-3 text-zinc-500">
                      {log.followUpDue
                        ? new Date(log.followUpDue).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <ExpandedRow key={`${log.id}-expanded`} log={log} onSave={handleSave} />
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
