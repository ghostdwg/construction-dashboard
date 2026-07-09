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
  evidenceExcerpt: string | null;
  sourceLocator: string | null;
  extractionMethod: string;
  citationVerified: boolean;
  closedBy: string | null;
  waivedReason: string | null;
  commentCount: number;
  attachmentCount: number;
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
  CLOSED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
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
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Operations Register</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          One tracked-item register for OAC actions, field/JSO items, warranty, closeout,
          training, O&M, testing, and attic stock. Every item cites its source; status
          changes are yours alone — nothing here closes, assigns, or notifies automatically.
        </p>
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
        <PromoteForm bidId={bidId} onPromoted={load} />
      </div>

      {loadError && <p className="text-sm text-red-500">{loadError}</p>}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No tracked items yet. Create one manually, or promote a meeting action item
          from the Meetings tab (by its item number) using “Promote”.
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Assignee</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">💬/📎</th>
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
        className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
      >
        <td className="px-3 py-2">
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            {KIND_LABELS[item.kind] ?? item.kind}
          </span>
        </td>
        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{item.title}</td>
        <td className="px-3 py-2">
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[item.status] ?? ""}`}>
            {item.status.replaceAll("_", " ")}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{item.priority}</td>
        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{item.assigneeName ?? "—"}</td>
        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
          {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "—"}
        </td>
        <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{sourceSummary(item)}</td>
        <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          {item.commentCount}/{item.attachmentCount}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-800/30">
          <td colSpan={8} className="px-4 py-3">
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
          <p className="mt-1 italic text-zinc-700 dark:text-zinc-300">“{item.evidenceExcerpt}”</p>
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
            className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-40"
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
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Comments</p>
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
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Attachments (jpeg/png/webp/pdf · metadata only in V1 — no preview yet)
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
                </span>
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
        className="rounded bg-zinc-900 px-2 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        New item…
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
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
        className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-40"
      >
        Create
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-zinc-500">
        Cancel
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}

function PromoteForm({ bidId, onPromoted }: { bidId: number; onPromoted: () => Promise<void> | void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const idNum = parseInt(value, 10);
    if (isNaN(idNum)) {
      setError("Enter a meeting action item #");
      return;
    }
    const res = await fetch(`/api/bids/${bidId}/tracked-items/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingActionItemId: idNum }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Promote failed");
      return;
    }
    setValue("");
    await onPromoted();
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="action item #"
        className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        title="Promote an existing meeting action item (see the Meetings tab) into this register — one at a time, your choice, never automatic."
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300"
      >
        Promote
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}
