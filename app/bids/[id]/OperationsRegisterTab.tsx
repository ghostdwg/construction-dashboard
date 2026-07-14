"use client";

// Module OPS1 (Slice 1) — the Operations Register: ONE shared tracked-item
// surface for OAC actions, field/JSO items, warranty/closeout/training/O&M,
// testing/inspection, and attic stock. Rows come from
// /api/bids/[id]/tracked-items; status changes go through the FSM route
// (human-only — close needs the session actor, waive needs a reason).
//
// V1 deliberately practical: append-only comment form, attachment
// UPLOAD + METADATA list (no byte-serving/preview route yet — the photo
// strip shows names/sizes honestly, not thumbnails), no AI anywhere, no
// notifications, no auto-anything.

import { useCallback, useEffect, useState } from "react";
import FieldReportsSection from "./FieldReportsSection";
import ConsultantReportsSection, {
  FormalResponseEditor,
} from "./ConsultantReportsSection";
import SpecGapHint from "./SpecGapHint";
import {
  actionItemOptionLabel,
  isOverdue,
  promotedActionItemIds,
  statusCounts,
} from "./registerViewHelpers";

type TrackedItemRow = {
  id: number;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeName: string | null;
  dueDate: string | null;
  sourceKind: string;
  sourceMeetingId: number | null;
  sourceMeetingActionItemId: number | null;
  sourceFieldReportId: number | null;
  sourceConsultantObservationId: number | null;
  evidenceExcerpt: string | null;
  sourceLocator: string | null;
  extractionMethod: string;
  citationVerified: boolean;
  closedBy: string | null;
  waivedReason: string | null;
  formalResponse: string | null;
  formalResponseBy: string | null;
  formalResponseAt: string | null;
  commentCount: number;
  attachmentCount: number;
  gapHintCount?: number;
};

type CommentRow = { id: number; authorName: string | null; authorEmail: string | null; body: string; createdAt: string };
type AttachmentRow = { id: number; fileName: string; mimeType: string; byteSize: number; kind: string; caption: string | null };

const KIND_LABELS: Record<string, string> = {
  OAC_ACTION: "OAC Action",
  FIELD_ITEM: "Field Item",
  JSO_ITEM: "JSO Item",
  WARRANTY: "Warranty",
  CLOSEOUT: "Closeout",
  TRAINING: "Training",
  OM: "O&M",
  TEST_INSPECTION: "Test / Inspection",
  ATTIC_STOCK: "Attic Stock",
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  READY_TO_CLOSE: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  CLOSED: "bg-[rgba(45,123,255,0.12)] text-[#E8EEFF]",
  WAIVED: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400",
};

const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "READY_TO_CLOSE", "CLOSED", "WAIVED"],
  IN_PROGRESS: ["OPEN", "READY_TO_CLOSE", "CLOSED", "WAIVED"],
  READY_TO_CLOSE: ["OPEN", "IN_PROGRESS", "CLOSED", "WAIVED"],
  CLOSED: [],
  WAIVED: [],
};

export default function OperationsRegisterTab({ bidId }: { bidId: number }) {
  const [items, setItems] = useState<TrackedItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (kindFilter) qs.set("kind", kindFilter);
      if (statusFilter) qs.set("status", statusFilter);
      const res = await fetch(`/api/bids/${bidId}/tracked-items?${qs.toString()}`);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = (await res.json()) as { items: TrackedItemRow[] };
      setItems(json.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [bidId, kindFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Operations Register
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Accountable project conditions and follow-up through resolution. Every
          Register Item cites its source; status changes are yours alone — nothing
          here closes, assigns, or notifies automatically.{" "}
          <span className="font-medium">Click a row to expand it and add comments and
          attachments.</span>
        </p>
        <AcceptanceHelper />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">All kinds</option>
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLES).map((s) => (
            <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
          ))}
        </select>
        <CreateItemForm bidId={bidId} onCreated={load} />
        <PromoteForm bidId={bidId} promotedIds={promotedActionItemIds(items)} onPromoted={load} />
      </div>

      {!loading && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {statusCounts(items).map(({ status, count }) => (
            <span
              key={status}
              className={`rounded px-2 py-0.5 font-semibold ${STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600"}`}
            >
              {status.replaceAll("_", " ")} {count}
            </span>
          ))}
          {(() => {
            const overdue = items.filter((i) => isOverdue(i.dueDate, i.status)).length;
            return overdue > 0 ? (
              <span className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">
                OVERDUE {overdue}
              </span>
            ) : null;
          })()}
          {(kindFilter || statusFilter) && (
            <span className="text-zinc-400">(counts reflect the current filter)</span>
          )}
        </div>
      )}

      {loadError && <p className="text-sm text-red-500">{loadError}</p>}

      {loading && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 px-3 py-2.5 last:border-b-0"
            >
              <div className="skeleton h-3.5 w-3.5 shrink-0" />
              <div className="skeleton h-5 w-20 rounded" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-5 w-20 rounded-full" />
              <div className="skeleton h-4 w-14" />
              <div className="skeleton h-4 w-20" />
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !loadError && (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: "var(--color-text-dim)" }} aria-hidden>
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          <p className="empty-state-title">No Register Items yet</p>
          <p className="empty-state-body">
            No Register Items yet. Create one manually with "New Register Item…" or promote a meeting action item
            using "Promote from meeting…" above.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="w-6 px-2 py-2" aria-label="Expand" />
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Assignee</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2" title="Comments / attachments — click the row to expand">
                  💬 Comments / 📎 Files
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  bidId={bidId}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onChanged={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Slice 2 — Field Report source documents (items created from a
          report land in the register above as FIELD ITEM). */}
      <FieldReportsSection bidId={bidId} onItemsChanged={load} />

      {/* Phase 1A — Consultant Reports (observations accepted here land in
          the register above, citing their originating observation). */}
      <ConsultantReportsSection bidId={bidId} onItemsChanged={load} />
    </div>
  );
}

function sourceSummary(item: TrackedItemRow): string {
  if (item.sourceKind === "meeting") {
    const meeting = item.sourceMeetingId ? `meeting #${item.sourceMeetingId}` : "meeting";
    return `${meeting}${item.sourceMeetingActionItemId ? ` · action item #${item.sourceMeetingActionItemId}` : ""}`;
  }
  if (item.sourceKind === "spec_section") return "spec section";
  if (item.sourceKind === "field_report") {
    return item.sourceFieldReportId
      ? `field report #${item.sourceFieldReportId}`
      : "field report";
  }
  if (item.sourceKind === "consultant_report") {
    return item.sourceConsultantObservationId
      ? `consultant observation #${item.sourceConsultantObservationId}`
      : "consultant report";
  }
  return "manual entry";
}

function ItemRow({
  bidId,
  item,
  expanded,
  onToggle,
  onChanged,
}: {
  bidId: number;
  item: TrackedItemRow;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void> | void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${item.title}` : `Expand ${item.title} to add comments and attachments`}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
        title={expanded ? "Collapse" : "Expand to add comments and attachments"}
        className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
      >
        <td className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500" aria-hidden>
          {expanded ? "▾" : "▸"}
        </td>
        <td className="px-3 py-2">
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            {KIND_LABELS[item.kind] ?? item.kind}
          </span>
        </td>
        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
          {item.title}
          {(item.gapHintCount ?? 0) > 0 && (
            <span
              className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300"
              title={`${item.gapHintCount} uncovered spec section${item.gapHintCount === 1 ? "" : "s"} may relate`}
            >
              {item.gapHintCount} spec
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[item.status] ?? ""}`}>
            {item.status.replaceAll("_", " ")}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{item.priority}</td>
        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{item.assigneeName ?? "—"}</td>
        <td
          className={
            isOverdue(item.dueDate, item.status)
              ? "px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400"
              : "px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300"
          }
        >
          {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "—"}
          {isOverdue(item.dueDate, item.status) && " (overdue)"}
        </td>
        <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{sourceSummary(item)}</td>
        <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          {item.commentCount}/{item.attachmentCount}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-800/30">
          <td colSpan={9} className="px-4 py-3">
            <ItemDetail bidId={bidId} item={item} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function ItemDetail({
  bidId,
  item,
  onChanged,
}: {
  bidId: number;
  item: TrackedItemRow;
  onChanged: () => Promise<void> | void;
}) {
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/api/bids/${bidId}/tracked-items/${item.id}`;

  const refresh = useCallback(async () => {
    const [c, a] = await Promise.all([
      fetch(`${base}/comments`).then((r) => (r.ok ? r.json() : { comments: [] })),
      fetch(`${base}/attachments`).then((r) => (r.ok ? r.json() : { attachments: [] })),
    ]);
    setComments((c as { comments: CommentRow[] }).comments);
    setAttachments((a as { attachments: AttachmentRow[] }).attachments);
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function transition(to: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          ...(to === "WAIVED" ? { waivedReason: waiveReason } : {}),
          ...(to === "CLOSED" && closeNote.trim() ? { note: closeNote.trim() } : {}),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Transition failed");
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!commentBody.trim()) return;
    const res = await fetch(`${base}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody.trim() }),
    });
    if (res.ok) {
      setCommentBody("");
      await refresh();
      await onChanged();
    }
  }

  async function uploadAttachment(file: File) {
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${base}/attachments`, { method: "POST", body: form });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Upload failed");
      return;
    }
    await refresh();
    await onChanged();
  }

  const nexts = NEXT_STATUSES[item.status] ?? [];

  return (
    <div className="space-y-3 text-sm">
      {item.description && <p className="text-zinc-700 dark:text-zinc-300">{item.description}</p>}

      {item.evidenceExcerpt && (
        <div className="rounded border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
          <p className="font-medium text-zinc-500 dark:text-zinc-400">
            Source evidence ({item.extractionMethod}
            {item.citationVerified ? ", verified" : ", unverified"}
            {item.sourceLocator ? ` · ${item.sourceLocator}` : ""}):
          </p>
          <p className="mt-1 italic text-zinc-700 dark:text-zinc-300">"{item.evidenceExcerpt}"</p>
          {item.sourceKind === "meeting" && (
            <p className="mt-1 text-zinc-400 dark:text-zinc-500">
              Speaker attributions in meeting evidence are draft labels, not verified identity.
            </p>
          )}
        </div>
      )}

      {item.status === "WAIVED" && item.waivedReason && (
        <p className="text-xs text-zinc-500">Waived: {item.waivedReason}</p>
      )}
      {item.status === "CLOSED" && item.closedBy && (
        <p className="text-xs text-zinc-500">Closed by {item.closedBy}</p>
      )}

      {/* Phase 1A — formal response, surface #1 (surface #2 lives on the
          Consultant Report detail; both PATCH the identical field). */}
      <FormalResponseEditor
        bidId={bidId}
        itemId={item.id}
        current={item.formalResponse}
        byline={
          item.formalResponseBy
            ? `Response by ${item.formalResponseBy}${
                item.formalResponseAt
                  ? ` · ${new Date(item.formalResponseAt).toLocaleDateString()}`
                  : ""
              }`
            : null
        }
        onSaved={onChanged}
      />

      {nexts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {nexts
            .filter((s) => s !== "CLOSED" && s !== "WAIVED")
            .map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => transition(s)}
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300"
              >
                → {s.replaceAll("_", " ")}
              </button>
            ))}
          <span className="mx-1 text-zinc-300 dark:text-zinc-600">|</span>
          <input
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            placeholder="closeout note (optional)"
            className="w-44 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            disabled={busy}
            onClick={() => transition("CLOSED")}
            className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            Close
          </button>
          <input
            value={waiveReason}
            onChange={(e) => setWaiveReason(e.target.value)}
            placeholder="waive reason (required)"
            className="w-44 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            disabled={busy || !waiveReason.trim()}
            onClick={() => transition("WAIVED")}
            className="rounded border border-zinc-400 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-500 disabled:opacity-40 dark:text-zinc-300"
          >
            Waive
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div>
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Comments</p>
        {comments === null ? (
          <p className="text-xs text-zinc-400">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-zinc-400">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {comments.map((c) => (
              <li key={c.id} className="text-xs text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-400">
                  {c.authorName ?? c.authorEmail ?? "unknown"} · {new Date(c.createdAt).toLocaleString()}:
                </span>{" "}
                {c.body}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex items-center gap-2">
          <input
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitComment()}
            placeholder="Add a comment (append-only)"
            className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={submitComment}
            disabled={!commentBody.trim()}
            className="rounded bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          Attachments{" "}
          <span className="font-normal text-zinc-500 dark:text-zinc-400">
            (jpeg/png/webp/pdf · download only — preview/OCR/AI extraction not built yet)
          </span>
        </p>
        {attachments === null ? (
          <p className="text-xs text-zinc-400">Loading…</p>
        ) : attachments.length === 0 ? (
          <p className="text-xs text-zinc-400">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {attachments.map((a) => (
              <li key={a.id} className="text-xs text-zinc-700 dark:text-zinc-300">
                {a.kind === "photo" ? "🖼" : "📄"} {a.fileName}{" "}
                <span className="text-zinc-400">
                  ({Math.max(1, Math.round(a.byteSize / 1024))} KB{a.caption ? ` · ${a.caption}` : ""})
                </span>{" "}
                <a
                  href={`${base}/attachments/${a.id}/download`}
                  className="text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
        <label className="mt-1 inline-block cursor-pointer rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300">
          Upload
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAttachment(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function CreateItemForm({ bidId, onCreated }: { bidId: number; onCreated: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("OAC_ACTION");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const res = await fetch(`/api/bids/${bidId}/tracked-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        title,
        ...(assignee.trim() ? { assigneeName: assignee.trim() } : {}),
        ...(due ? { dueDate: new Date(due).toISOString() } : {}),
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Create failed");
      return;
    }
    setTitle("");
    setAssignee("");
    setDue("");
    setOpen(false);
    await onCreated();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Create new register item"
        className="rounded bg-zinc-900 px-2 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        New Register Item…
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="title"
          className="w-48 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="assignee"
          className="w-28 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white disabled:opacity-40"
        >
          Create
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-zinc-500">
          Cancel
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
      <SpecGapHint bidId={bidId} title={title} />
    </div>
  );
}

type PickerOption = {
  id: number;
  meetingTitle: string;
  description: string;
  status: string;
};

// Promote-from-meeting picker. Loads the bid's meetings and their action
// items on demand (same read endpoints the Meetings tab uses) and lets the
// user pick one instead of memorizing its number; a manual "# " entry is
// kept as a fallback. `promotedIds` is a hint derived from the register
// rows currently loaded — options it contains are annotated/disabled, but
// the server's unique guard (409) stays the source of truth, since a
// filtered register view can under-report.
function PromoteForm({
  bidId,
  promotedIds,
  onPromoted,
}: {
  bidId: number;
  promotedIds: Set<number>;
  onPromoted: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickerOption[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadOptions() {
    setPickerError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings`);
      if (!res.ok) throw new Error(`Meetings load failed (${res.status})`);
      const { meetings } = (await res.json()) as {
        meetings: Array<{ id: number; title: string }>;
      };
      const perMeeting = await Promise.all(
        meetings.map(async (m) => {
          const r = await fetch(`/api/bids/${bidId}/meetings/${m.id}/action-items`);
          if (!r.ok) return [] as PickerOption[];
          const data = (await r.json()) as {
            actionItems: Array<{ id: number; description: string; status: string }>;
          };
          return data.actionItems.map((a) => ({
            id: a.id,
            meetingTitle: m.title,
            description: a.description,
            status: a.status,
          }));
        })
      );
      setOptions(perMeeting.flat());
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : "Load failed");
      setOptions(null);
    }
  }

  async function promote(idNum: number) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/tracked-items/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingActionItemId: idNum }),
      });
      const json = (await res.json()) as { error?: string };
      if (res.status === 409) {
        setError("Already tracked in the register.");
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Promote failed");
        return;
      }
      setSelected("");
      setManual("");
      await onPromoted();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          void loadOptions();
        }}
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300"
        title="Promote an existing meeting action item (see the Meetings tab) into this register — one at a time, your choice, never automatic."
      >
        Promote from meeting…
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {options === null && !pickerError && (
        <span className="text-xs text-zinc-400">Loading action items…</span>
      )}
      {pickerError && <span className="text-xs text-red-500">{pickerError}</span>}
      {options !== null && options.length === 0 && (
        <span className="text-xs text-zinc-400">
          No meeting action items on this bid yet — record them in the Meetings tab first.
        </span>
      )}
      {options !== null && options.length > 0 && (
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="max-w-[22rem] rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">Pick a meeting action item…</option>
          {options.map((o) => {
            const alreadyTracked = promotedIds.has(o.id);
            return (
              <option key={o.id} value={o.id} disabled={alreadyTracked}>
                {actionItemOptionLabel({ ...o, alreadyTracked })}
              </option>
            );
          })}
        </select>
      )}
      <input
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        placeholder="or #"
        className="w-16 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        title="Fallback: enter a meeting action item number directly."
      />
      <button
        onClick={() => {
          const idNum = selected ? parseInt(selected, 10) : parseInt(manual, 10);
          if (isNaN(idNum)) {
            setError("Pick an action item or enter its #");
            return;
          }
          void promote(idNum);
        }}
        disabled={busy || (!selected && !manual.trim())}
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300"
      >
        Promote
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-zinc-500">
        Cancel
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}

const ACCEPTANCE_STEPS = [
  "Create a Register Item (use “New item” — pick a kind like OAC, closeout, or warranty)",
  "Expand the item (click its row — the ▸ arrow turns to ▾)",
  "Add a comment in the expanded panel",
  "Upload an attachment (jpeg/png/webp/pdf, 25 MB max)",
  "Download the attachment via its Download link",
  "Create a Field Report (in the Field Reports section below)",
  "Upload and download the report file",
  "Create a Register Item from that report — it appears in this register as FIELD ITEM",
];

function AcceptanceHelper() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {open ? "Hide" : "Show"} first-run walkthrough
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1 rounded border border-zinc-200 bg-zinc-50 px-6 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
          {ACCEPTANCE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
