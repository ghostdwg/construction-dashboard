"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type RfiStatus = "OPEN" | "SENT" | "ANSWERED" | "CLOSED" | "NO_RESPONSE";
type RfiPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type Question = {
  id: number;
  rfiNumber: number | null;
  gapFindingId: number | null;
  tradeName: string | null;
  questionText: string;
  isInternal: boolean;
  status: RfiStatus;
  priority: RfiPriority;
  sentAt: string | null;
  responseText: string | null;
  respondedAt: string | null;
  respondedBy: string | null;
  impactFlag: boolean;
  impactNote: string | null;
  sourceRef: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

type Summary = {
  total: number;
  open: number;
  sent: number;
  answered: number;
  closed: number;
  noResponse: number;
  criticalOpen: number;
  impactFlagged: number;
};

type BidTrade = { tradeId: number; trade: { name: string } };

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<RfiStatus, string> = {
  OPEN: "Open",
  SENT: "Sent",
  ANSWERED: "Answered",
  CLOSED: "Closed",
  NO_RESPONSE: "No Response",
};

const STATUS_COLORS: Record<RfiStatus, string> = {
  OPEN: "bg-blue-100 text-blue-700",
  SENT: "bg-purple-100 text-purple-700",
  ANSWERED: "bg-green-100 text-green-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
  NO_RESPONSE: "bg-red-100 text-red-600",
};

const PRIORITY_LABELS: Record<RfiPriority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const PRIORITY_COLORS: Record<RfiPriority, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  MEDIUM: "bg-zinc-100 text-zinc-600",
  LOW: "bg-zinc-50 text-zinc-400",
};

const PRIORITY_ORDER: RfiPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const STATUS_FILTER_OPTIONS: Array<{ value: RfiStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "SENT", label: "Sent" },
  { value: "ANSWERED", label: "Answered" },
  { value: "CLOSED", label: "Closed" },
  { value: "NO_RESPONSE", label: "No Response" },
];

const OVERDUE_DAYS = 5;

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

function rfiLabel(n: number | null): string {
  if (n == null) return "";
  return `RFI-${String(n).padStart(3, "0")}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function sortQuestions(questions: Question[]): Question[] {
  const priorityRank: Record<RfiPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const activeStatuses: Set<RfiStatus> = new Set(["OPEN", "SENT", "NO_RESPONSE"]);
  const doneStatuses: Set<RfiStatus> = new Set(["ANSWERED", "CLOSED"]);

  return [...questions].sort((a, b) => {
    const aDone = doneStatuses.has(a.status);
    const bDone = doneStatuses.has(b.status);
    if (aDone !== bDone) return aDone ? 1 : -1;

    const pr = priorityRank[a.priority] - priorityRank[b.priority];
    if (pr !== 0) return pr;

    if (!aDone && !bDone) {
      const aActive = activeStatuses.has(a.status) ? 0 : 1;
      const bActive = activeStatuses.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
    }

    if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function recomputeSummary(qs: Question[]): Summary {
  return {
    total: qs.length,
    open: qs.filter((q) => q.status === "OPEN").length,
    sent: qs.filter((q) => q.status === "SENT").length,
    answered: qs.filter((q) => q.status === "ANSWERED").length,
    closed: qs.filter((q) => q.status === "CLOSED").length,
    noResponse: qs.filter((q) => q.status === "NO_RESPONSE").length,
    criticalOpen: qs.filter((q) => q.priority === "CRITICAL" && ["OPEN", "SENT", "NO_RESPONSE"].includes(q.status)).length,
    impactFlagged: qs.filter((q) => q.impactFlag).length,
  };
}

function exportCsv(questions: Question[]): void {
  const headers = ["RFI #", "Status", "Priority", "Trade", "Question", "Source Ref", "Due Date", "Response", "Responded By", "Responded At", "Impact", "Impact Note", "Created"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = questions.map((q) => [
    rfiLabel(q.rfiNumber),
    STATUS_LABELS[q.status],
    PRIORITY_LABELS[q.priority],
    q.tradeName ?? "",
    q.questionText,
    q.sourceRef ?? "",
    fmt(q.dueDate),
    q.responseText ?? "",
    q.respondedBy ?? "",
    fmt(q.respondedAt),
    q.impactFlag ? "Yes" : "",
    q.impactNote ?? "",
    fmt(q.createdAt),
  ].map(escape).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rfi-register.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ─────────────────────────────────────────────────────────

export default function QuestionsTab({ bidId }: { bidId: number }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bidTrades, setBidTrades] = useState<BidTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<RfiStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<RfiPriority | "">("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [searchText, setSearchText] = useState("");

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Add question modal
  const [showAddModal, setShowAddModal] = useState(false);

  // Fetch bid trades for the Add Question modal
  useEffect(() => {
    fetch(`/api/bids/${bidId}/trades`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) setBidTrades(data);
      })
      .catch(() => {});
  }, [bidId]);

  // Initial questions load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qRes = await fetch(`/api/bids/${bidId}/questions`);
        const qData = await qRes.json();
        if (cancelled) return;
        if (qRes.ok) {
          setQuestions(Array.isArray(qData.questions) ? qData.questions : []);
          setSummary(qData.summary ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bidId]);

  async function patchQuestion(id: number, patch: Record<string, unknown>) {
    const res = await fetch(`/api/bids/${bidId}/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated: Question = await res.json();
      setQuestions((prev) => {
        const next = prev.map((q) => (q.id === updated.id ? updated : q));
        setSummary(recomputeSummary(next));
        return next;
      });
    }
  }

  // Bulk action: patch multiple questions
  const bulkPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/bids/${bidId}/questions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }).then((r) => r.ok ? r.json() as Promise<Question> : null)
      )
    );
    setQuestions((prev) => {
      const updates = new Map<number, Question>();
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) updates.set(r.value.id, r.value);
      }
      const next = prev.map((q) => updates.get(q.id) ?? q);
      setSummary(recomputeSummary(next));
      return next;
    });
    setSelected(new Set());
    setBulkBusy(false);
  }, [selected, bidId]);

  // Unique trade names for filter dropdown
  const tradeNames = Array.from(
    new Set(questions.map((q) => q.tradeName).filter(Boolean) as string[])
  ).sort();

  const filtered = sortQuestions(
    questions.filter((q) => {
      if (statusFilter && q.status !== statusFilter) return false;
      if (priorityFilter && q.priority !== priorityFilter) return false;
      if (tradeFilter && q.tradeName !== tradeFilter) return false;
      if (searchText && !q.questionText.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    })
  );

  // Overdue detection: SENT items past due date or sent > OVERDUE_DAYS ago with no response
  const overdueIds = new Set(
    questions
      .filter((q) => {
        if (q.status !== "SENT") return false;
        if (q.dueDate && new Date(q.dueDate) < new Date()) return true;
        if (q.sentAt && daysSince(q.sentAt) >= OVERDUE_DAYS) return true;
        return false;
      })
      .map((q) => q.id)
  );

  const hasFilters = statusFilter || priorityFilter || tradeFilter || searchText;

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((q) => q.id)));
    }
  };

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (error) return <p className="text-sm text-red-500">Error: {error}</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* Header summary bar */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="text-zinc-700">
            <span className="font-semibold">{summary?.total ?? questions.length}</span>{" "}
            <span className="text-zinc-500">total</span>
          </span>
          {(summary?.open ?? 0) > 0 && (
            <span className="text-zinc-700">
              <span className="font-semibold">{summary!.open}</span>{" "}
              <span className="text-zinc-500">open</span>
            </span>
          )}
          {(summary?.sent ?? 0) > 0 && (
            <span className="text-zinc-700">
              <span className="font-semibold">{summary!.sent}</span>{" "}
              <span className="text-zinc-500">sent</span>
            </span>
          )}
          {(summary?.answered ?? 0) > 0 && (
            <span className="text-zinc-700">
              <span className="font-semibold">{summary!.answered}</span>{" "}
              <span className="text-zinc-500">answered</span>
            </span>
          )}
          {(summary?.criticalOpen ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              {summary!.criticalOpen} critical open
            </span>
          )}
          {(summary?.impactFlagged ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
              {summary!.impactFlagged} impact flagged
            </span>
          )}
          {overdueIds.size > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
              {overdueIds.size} overdue
            </span>
          )}
          {questions.length === 0 && (
            <span className="text-zinc-400">No questions yet.</span>
          )}
        </div>
      </div>

      {/* Filter bar + actions */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RfiStatus | "")}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none"
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as RfiPriority | "")}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none"
        >
          <option value="">All priorities</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
        {tradeNames.length > 1 && (
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none"
          >
            <option value="">All trades</option>
            {tradeNames.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search questions…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none min-w-[180px]"
        />
        {hasFilters && (
          <button
            onClick={() => { setStatusFilter(""); setPriorityFilter(""); setTradeFilter(""); setSearchText(""); }}
            className="text-sm text-zinc-400 hover:text-zinc-700"
          >
            Clear
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {filtered.length > 0 && (
            <button
              onClick={() => exportCsv(filtered)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-500 hover:text-zinc-900"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
          >
            + Add Question
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-zinc-300 bg-zinc-50 px-4 py-2">
          <span className="text-sm text-zinc-600">
            <span className="font-semibold">{selected.size}</span> selected
          </span>
          <button
            onClick={() => bulkPatch({ status: "SENT", sentAt: new Date().toISOString() })}
            disabled={bulkBusy}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            Mark Sent
          </button>
          <button
            onClick={() => bulkPatch({ status: "NO_RESPONSE" })}
            disabled={bulkBusy}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            Mark No Response
          </button>
          <button
            onClick={() => bulkPatch({ status: "CLOSED" })}
            disabled={bulkBusy}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-zinc-400 hover:text-zinc-700"
          >
            Deselect all
          </button>
        </div>
      )}

      {/* Question cards */}
      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-400 italic">
            {questions.length === 0
              ? "No questions yet. Add one manually or generate from gap analysis findings."
              : "No questions match the current filter."}
          </p>
        )}
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
              className="rounded"
            />
            Select all ({filtered.length})
          </label>
        )}
        {filtered.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            isSelected={selected.has(q.id)}
            isOverdue={overdueIds.has(q.id)}
            onToggleSelect={() => toggleSelect(q.id)}
            onPatch={(patch) => patchQuestion(q.id, patch)}
          />
        ))}
      </div>

      {/* Add Question modal */}
      {showAddModal && (
        <AddQuestionModal
          bidId={bidId}
          bidTrades={bidTrades}
          onClose={() => setShowAddModal(false)}
          onAdded={(q) => {
            setQuestions((prev) => {
              const next = [...prev, q];
              setSummary(recomputeSummary(next));
              return next;
            });
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Question card ──────────────────────────────────────────────────────────

function QuestionCard({
  question,
  isSelected,
  isOverdue,
  onToggleSelect,
  onPatch,
}: {
  question: Question;
  isSelected: boolean;
  isOverdue: boolean;
  onToggleSelect: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [editingPriority, setEditingPriority] = useState(false);

  // Response form state
  const [responseText, setResponseText] = useState(question.responseText ?? "");
  const [respondedBy, setRespondedBy] = useState(question.respondedBy ?? "");
  const [impactFlag, setImpactFlag] = useState(question.impactFlag);
  const [impactNote, setImpactNote] = useState(question.impactNote ?? "");

  const priorityRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editingPriority) priorityRef.current?.focus();
  }, [editingPriority]);

  async function act(patch: Record<string, unknown>) {
    setBusy(true);
    await onPatch(patch);
    setBusy(false);
  }

  async function saveResponse() {
    setBusy(true);
    await onPatch({
      status: "ANSWERED",
      responseText: responseText.trim() || null,
      respondedBy: respondedBy.trim() || null,
      respondedAt: new Date().toISOString(),
      impactFlag,
      impactNote: impactFlag ? (impactNote.trim() || null) : null,
    });
    setShowResponseForm(false);
    setBusy(false);
  }

  async function toggleImpact() {
    const next = !question.impactFlag;
    await act({ impactFlag: next, impactNote: next ? question.impactNote : null });
  }

  const isDue = question.dueDate && new Date(question.dueDate) < new Date();
  const isAnswered = question.status === "ANSWERED";

  return (
    <div className={`rounded-md border bg-white p-4 flex flex-col gap-3 ${isOverdue ? "border-orange-300 bg-orange-50/30" : "border-zinc-200"}`}>
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="rounded"
        />

        {/* RFI number */}
        {question.rfiNumber != null && (
          <span className="rounded bg-zinc-200 px-2 py-0.5 text-[11px] font-mono font-semibold text-zinc-700">
            {rfiLabel(question.rfiNumber)}
          </span>
        )}

        {/* Priority badge — click to edit */}
        <div className="relative">
          {editingPriority ? (
            <select
              ref={priorityRef}
              defaultValue={question.priority}
              onBlur={() => setEditingPriority(false)}
              onChange={async (e) => {
                setEditingPriority(false);
                await act({ priority: e.target.value });
              }}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold border border-zinc-300 bg-white focus:outline-none"
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingPriority(true)}
              title="Click to change priority"
              className={`rounded px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${PRIORITY_COLORS[question.priority]}`}
            >
              {PRIORITY_LABELS[question.priority]}
            </button>
          )}
        </div>

        {/* Status badge */}
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[question.status]}`}>
          {STATUS_LABELS[question.status]}
        </span>

        {/* Overdue badge */}
        {isOverdue && (
          <span className="rounded px-2 py-0.5 text-[11px] font-semibold bg-orange-100 text-orange-700">
            Overdue
          </span>
        )}

        {/* Trade */}
        {question.tradeName && (
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600">
            {question.tradeName}
          </span>
        )}

        {/* Source badge */}
        {question.gapFindingId ? (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-600">
            Gap Analysis
          </span>
        ) : (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500">
            Manual
          </span>
        )}

        {/* Due date */}
        {question.dueDate && (
          <span className={`ml-auto text-xs ${isDue ? "text-red-600 font-semibold" : "text-zinc-400"}`}>
            Due {fmt(question.dueDate)}
          </span>
        )}

        {/* Impact flag indicator */}
        {question.impactFlag && (
          <span className="rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-700">
            Impact
          </span>
        )}
      </div>

      {/* Question text */}
      <p className="text-sm text-zinc-800 leading-relaxed">{question.questionText}</p>

      {/* Source ref */}
      {question.sourceRef && (
        <p className="text-xs italic text-zinc-400">{question.sourceRef}</p>
      )}

      {/* Response (when answered) */}
      {isAnswered && question.responseText && (
        <div className="rounded-md border border-green-100 bg-green-50 p-3 flex flex-col gap-1">
          <p className="text-sm text-zinc-700">{question.responseText}</p>
          {(question.respondedBy || question.respondedAt) && (
            <p className="text-xs text-zinc-400">
              From: {question.respondedBy || "—"}{question.respondedAt ? ` on ${fmt(question.respondedAt)}` : ""}
            </p>
          )}
          {question.impactFlag && (
            <div className="mt-1 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs font-semibold text-amber-700 mb-0.5">Impact noted</p>
              {question.impactNote && (
                <p className="text-xs text-amber-700">{question.impactNote}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Response form (inline expand) */}
      {showResponseForm && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-3">
          <textarea
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            placeholder="Response text…"
            rows={3}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none resize-none"
          />
          <input
            type="text"
            value={respondedBy}
            onChange={(e) => setRespondedBy(e.target.value)}
            placeholder="Responded by (name)"
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
            <input
              type="checkbox"
              checked={impactFlag}
              onChange={(e) => setImpactFlag(e.target.checked)}
              className="rounded"
            />
            Flag as scope/cost impact
          </label>
          {impactFlag && (
            <textarea
              value={impactNote}
              onChange={(e) => setImpactNote(e.target.value)}
              placeholder="Describe the impact…"
              rows={2}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none resize-none"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={saveResponse}
              disabled={busy}
              className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Save Response
            </button>
            <button
              onClick={() => setShowResponseForm(false)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap gap-2">
        {question.status === "OPEN" && (
          <button
            onClick={() => act({ status: "SENT", sentAt: new Date().toISOString() })}
            disabled={busy}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            Mark Sent
          </button>
        )}
        {isOverdue && question.status === "SENT" && (
          <button
            onClick={() => act({ status: "NO_RESPONSE" })}
            disabled={busy}
            className="rounded border border-orange-300 bg-orange-50 px-3 py-1 text-xs text-orange-700 hover:bg-orange-100 disabled:opacity-50"
          >
            Mark No Response
          </button>
        )}
        {(question.status === "OPEN" || question.status === "SENT") && !showResponseForm && (
          <button
            onClick={() => setShowResponseForm(true)}
            disabled={busy}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            Record Response
          </button>
        )}
        <button
          onClick={toggleImpact}
          disabled={busy}
          className={`rounded border px-3 py-1 text-xs disabled:opacity-50 ${
            question.impactFlag
              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:text-zinc-900"
          }`}
        >
          {question.impactFlag ? "Impact Flagged" : "Flag Impact"}
        </button>
        {isAnswered && (
          <button
            onClick={() => act({ status: "CLOSED" })}
            disabled={busy}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add Question modal ─────────────────────────────────────────────────────

function AddQuestionModal({
  bidId,
  bidTrades,
  onClose,
  onAdded,
}: {
  bidId: number;
  bidTrades: BidTrade[];
  onClose: () => void;
  onAdded: (q: Question) => void;
}) {
  const [questionText, setQuestionText] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [priority, setPriority] = useState<RfiPriority>("MEDIUM");
  const [sourceRef, setSourceRef] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!questionText.trim()) { setErr("Question text is required."); return; }
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/bids/${bidId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionText: questionText.trim(),
        tradeName: tradeName || undefined,
        priority,
        sourceRef: sourceRef.trim() || undefined,
        dueDate: dueDate || undefined,
      }),
    });
    if (res.ok) {
      const q: Question = await res.json();
      onAdded(q);
    } else {
      const d = await res.json();
      setErr(d.error ?? "Failed to save.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4">
        <h3 className="text-base font-semibold text-zinc-900">Add Question</h3>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Question text *</label>
          <textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            rows={3}
            className="rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Trade</label>
            <select
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none"
            >
              <option value="">— none —</option>
              {bidTrades.map((bt) => (
                <option key={bt.tradeId} value={bt.trade.name}>{bt.trade.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as RfiPriority)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none"
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Source ref</label>
            <input
              type="text"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="e.g. Spec 09 65 00"
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Due date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none"
            />
          </div>
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded border border-zinc-300 px-4 py-1.5 text-sm text-zinc-600 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add Question"}
          </button>
        </div>
      </div>
    </div>
  );
}
