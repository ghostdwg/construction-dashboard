"use client";

import { useEffect, useState, useRef } from "react";

type Question = {
  id: number;
  gapFindingId: number | null;
  tradeName: string | null;
  questionText: string;
  isInternal: boolean;
  status: string;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_ORDER = ["draft", "approved", "queued", "sent", "answered", "unanswered"] as const;
type Status = (typeof STATUS_ORDER)[number];

const STATUS_LABELS: Record<Status, string> = {
  draft: "Draft",
  approved: "Approved",
  queued: "Queued",
  sent: "Sent",
  answered: "Answered",
  unanswered: "Unanswered",
};

const STATUS_COLORS: Record<Status, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  approved: "bg-blue-100 text-blue-700",
  queued: "bg-amber-100 text-amber-700",
  sent: "bg-purple-100 text-purple-700",
  answered: "bg-green-100 text-green-700",
  unanswered: "bg-red-100 text-red-600",
};

// What button(s) appear for each status
const NEXT_ACTIONS: Record<Status, { label: string; status: Status }[]> = {
  draft: [{ label: "Approve", status: "approved" }],
  approved: [{ label: "Move to Queue", status: "queued" }],
  queued: [{ label: "Mark Sent", status: "sent" }],
  sent: [
    { label: "Mark Answered", status: "answered" },
    { label: "Mark Unanswered", status: "unanswered" },
  ],
  answered: [],
  unanswered: [],
};

export default function QuestionsTab({ bidId }: { bidId: number }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradeFilter, setTradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/questions`)
      .then((r) => r.json())
      .then((data: Question[]) => {
        setQuestions(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, [bidId]);

  async function updateQuestion(id: number, patch: { status?: Status; questionText?: string }) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated: Question = await res.json();
        setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
      }
    } finally {
      setUpdatingId(null);
    }
  }

  // Unique trade names for filter dropdown
  const tradeNames = Array.from(
    new Set(questions.map((q) => q.tradeName).filter(Boolean) as string[])
  ).sort();

  const filtered = questions.filter((q) => {
    if (tradeFilter && q.tradeName !== tradeFilter) return false;
    if (statusFilter && q.status !== statusFilter) return false;
    return true;
  });

  // Summary counts
  const counts = STATUS_ORDER.reduce(
    (acc, s) => ({ ...acc, [s]: questions.filter((q) => q.status === s).length }),
    {} as Record<Status, number>
  );

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm">
        {STATUS_ORDER.map((s) => (
          counts[s] > 0 && (
            <span key={s} className="text-zinc-700">
              <span className="font-semibold">{counts[s]}</span>{" "}
              <span className="text-zinc-500">{STATUS_LABELS[s]}</span>
            </span>
          )
        ))}
        {questions.length === 0 && (
          <span className="text-zinc-400">No questions yet. Generate them from approved findings.</span>
        )}
      </div>

      {questions.length > 0 && (
        <>
          {/* Filters */}
          <div className="flex gap-3">
            <select
              value={tradeFilter}
              onChange={(e) => setTradeFilter(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              <option value="">All trades</option>
              {tradeNames.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Status | "")}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              <option value="">All statuses</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            {(tradeFilter || statusFilter) && (
              <button
                onClick={() => { setTradeFilter(""); setStatusFilter(""); }}
                className="text-sm text-zinc-400 hover:text-zinc-700"
              >
                Clear
              </button>
            )}
          </div>

          {/* Question cards */}
          <div className="flex flex-col gap-3">
            {filtered.length === 0 && (
              <p className="text-sm text-zinc-400 italic">No questions match the current filter.</p>
            )}
            {filtered.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                updating={updatingId === q.id}
                onUpdate={(patch) => updateQuestion(q.id, patch)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QuestionCard({
  question,
  updating,
  onUpdate,
}: {
  question: Question;
  updating: boolean;
  onUpdate: (patch: { status?: Status; questionText?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(question.questionText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(question.questionText);
  }, [question.questionText]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function handleBlur() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== question.questionText) {
      onUpdate({ questionText: trimmed });
    }
  }

  const status = question.status as Status;
  const actions = NEXT_ACTIONS[status] ?? [];

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {question.tradeName && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600">
              {question.tradeName}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-zinc-100 text-zinc-600"}`}>
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>
      </div>

      {/* Inline editable text */}
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          rows={3}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="text-sm text-zinc-700 leading-relaxed cursor-text hover:bg-zinc-50 rounded px-1 -mx-1 py-0.5 transition-colors"
          title="Click to edit"
        >
          {question.questionText}
        </p>
      )}

      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex gap-2">
          {actions.map((action) => (
            <button
              key={action.status}
              onClick={() => onUpdate({ status: action.status })}
              disabled={updating}
              className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
