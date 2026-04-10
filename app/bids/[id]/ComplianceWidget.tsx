"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type ComplianceCategory = "bonding" | "labor" | "dbe" | "documentation";

type ComplianceItem = {
  key: string;
  label: string;
  category: ComplianceCategory;
  checked: boolean;
  note: string | null;
};

type ComplianceSummary = { total: number; checked: number; unchecked: number };

type ComplianceData = {
  projectType: string;
  checklist: ComplianceItem[];
  summary: ComplianceSummary;
};

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  bonding: "Bonding",
  labor: "Labor",
  dbe: "DBE / Participation",
  documentation: "Documentation",
};

const CATEGORY_ORDER: ComplianceCategory[] = ["bonding", "labor", "dbe", "documentation"];

function statusColor(summary: ComplianceSummary): { bg: string; border: string; text: string } {
  const pct = summary.total > 0 ? summary.checked / summary.total : 0;
  if (pct >= 1) return { bg: "bg-green-50", border: "border-green-200", text: "text-green-700" };
  if (pct >= 0.5) return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" };
  return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700" };
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ComplianceWidget({ bidId }: { bidId: number }) {
  const [data, setData] = useState<ComplianceData | null | undefined>(undefined);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/compliance`);
        if (cancelled) return;
        if (!res.ok) { setData(null); return; }
        setData(await res.json() as ComplianceData);
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [bidId]);

  async function toggle(key: string, checked: boolean) {
    const res = await fetch(`/api/bids/${bidId}/compliance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, checked }),
    });
    if (res.ok) {
      const updated = await res.json() as { checklist: ComplianceItem[]; summary: ComplianceSummary };
      setData((prev) => prev ? { ...prev, checklist: updated.checklist, summary: updated.summary } : prev);
    }
  }

  async function saveNote(key: string) {
    const res = await fetch(`/api/bids/${bidId}/compliance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, note: noteText.trim() || null }),
    });
    if (res.ok) {
      const updated = await res.json() as { checklist: ComplianceItem[]; summary: ComplianceSummary };
      setData((prev) => prev ? { ...prev, checklist: updated.checklist, summary: updated.summary } : prev);
    }
    setEditingNote(null);
  }

  // Loading
  if (data === undefined) {
    return <div className="h-16 rounded-md bg-zinc-100 animate-pulse dark:bg-zinc-800" />;
  }

  // Error or non-PUBLIC (API returns data for all types, but we only render for PUBLIC)
  if (!data || data.projectType !== "PUBLIC") return null;

  const { checklist, summary } = data;
  const colors = statusColor(summary);

  // Group by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: checklist.filter((c) => c.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Public Bid Compliance</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors.text} ${colors.bg}`}>
          {summary.checked}/{summary.total}
        </span>
      </div>

      {/* Status bar */}
      <div className={`rounded-md border px-5 py-3 ${colors.border} ${colors.bg}`}>
        <p className={`text-sm font-semibold ${colors.text}`}>
          {summary.checked === summary.total
            ? "All compliance items verified"
            : summary.checked === 0
            ? "No compliance items checked — review required"
            : `${summary.unchecked} item${summary.unchecked !== 1 ? "s" : ""} remaining`}
        </p>
      </div>

      {/* Category groups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {grouped.map(({ category, items }) => (
          <div key={category} className="rounded-md border border-zinc-200 bg-white overflow-hidden dark:border-zinc-700 dark:bg-zinc-900">
            <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 dark:bg-zinc-800 dark:border-zinc-800">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
                {CATEGORY_LABELS[category]}
              </span>
              <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                {items.filter((i) => i.checked).length}/{items.length}
              </span>
            </div>
            <div className="px-4 py-2 flex flex-col gap-1">
              {items.map((item) => (
                <div key={item.key} className="flex flex-col">
                  <div className="flex items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => toggle(item.key, !item.checked)}
                      className="rounded"
                    />
                    <span className={`text-sm flex-1 ${item.checked ? "text-zinc-400 line-through" : "text-zinc-700"}`}>
                      {item.label}
                    </span>
                    <button
                      onClick={() => {
                        if (editingNote === item.key) {
                          setEditingNote(null);
                        } else {
                          setEditingNote(item.key);
                          setNoteText(item.note ?? "");
                        }
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        item.note
                          ? "text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30"
                          : "text-zinc-400 hover:text-zinc-600"
                      }`}
                      title={item.note ? "Edit note" : "Add note"}
                    >
                      {item.note ? "Note" : "+"}
                    </button>
                  </div>
                  {/* Inline note display */}
                  {item.note && editingNote !== item.key && (
                    <p className="text-xs text-zinc-500 italic ml-6 mb-1 dark:text-zinc-400">{item.note}</p>
                  )}
                  {/* Inline note editor */}
                  {editingNote === item.key && (
                    <div className="ml-6 mb-2 flex gap-2">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add a note…"
                        className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none dark:border-zinc-600 dark:bg-zinc-900"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") saveNote(item.key); }}
                      />
                      <button
                        onClick={() => saveNote(item.key)}
                        className="rounded bg-zinc-900 px-2.5 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingNote(null)}
                        className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
