"use client";

// Module H1 — Project Contacts panel
//
// Reusable, self-contained component for managing owner / architect / engineer
// / internal-team contacts on a Bid. Mounted on both the Overview tab (where
// contacts are typically captured) and the Handoff tab (where they're consumed
// when compiling the handoff packet).
//
// Behavior:
//   - Fetches /api/bids/:id/contacts on mount and after every save/delete.
//   - Renders contacts grouped by role.
//   - Click "+ Add Contact" → injects a new in-progress row in edit mode.
//   - Click a row → expands to edit form. Save / Cancel / Delete.
//   - When `onChanged` is provided, parent is notified after any mutation
//     (used by the Handoff tab to refetch the packet).

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

const CONTACT_ROLES = [
  "OWNER",
  "OWNER_REP",
  "ARCHITECT",
  "ENGINEER",
  "INTERNAL_PM",
  "INTERNAL_ESTIMATOR",
  "INTERNAL_SUPER",
  "OTHER",
] as const;

type ContactRole = (typeof CONTACT_ROLES)[number];

const ROLE_LABELS: Record<ContactRole, string> = {
  OWNER: "Owner",
  OWNER_REP: "Owner's Rep",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  INTERNAL_PM: "Internal — PM",
  INTERNAL_ESTIMATOR: "Internal — Estimator",
  INTERNAL_SUPER: "Internal — Superintendent",
  OTHER: "Other",
};

const ROLE_BADGE_STYLES: Record<ContactRole, string> = {
  OWNER: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  OWNER_REP: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ARCHITECT: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  ENGINEER: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  INTERNAL_PM: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  INTERNAL_ESTIMATOR: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  INTERNAL_SUPER: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  OTHER: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

type ProjectContact = {
  id: number;
  bidId: number;
  role: ContactRole;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  role: ContactRole;
  name: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
  isPrimary: boolean;
};

const EMPTY_DRAFT: Draft = {
  role: "OWNER",
  name: "",
  company: "",
  title: "",
  email: "",
  phone: "",
  notes: "",
  isPrimary: false,
};

function toDraft(c: ProjectContact): Draft {
  return {
    role: c.role,
    name: c.name,
    company: c.company ?? "",
    title: c.title ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    notes: c.notes ?? "",
    isPrimary: c.isPrimary,
  };
}

function draftToPayload(d: Draft) {
  return {
    role: d.role,
    name: d.name.trim(),
    company: d.company.trim() || null,
    title: d.title.trim() || null,
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    notes: d.notes.trim() || null,
    isPrimary: d.isPrimary,
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ProjectContactsPanel({
  bidId,
  onChanged,
}: {
  bidId: number;
  /** Called after any mutation. Used by parent to refetch dependent data. */
  onChanged?: () => void;
}) {
  const [contacts, setContacts] = useState<ProjectContact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // ID of the contact currently being edited. -1 = new (in-progress) row.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Export menu open state
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/contacts`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { items: ProjectContact[] };
        if (cancelled) return;
        setContacts(data.items);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bidId, reloadTick]);

  function startAdd() {
    setEditingId(-1);
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(c: ProjectContact) {
    setEditingId(c.id);
    setDraft(toDraft(c));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    try {
      const payload = draftToPayload(draft);
      const isNew = editingId === -1;
      const res = await fetch(
        isNew
          ? `/api/bids/${bidId}/contacts`
          : `/api/bids/${bidId}/contacts/${editingId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      setReloadTick((t) => t + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function downloadExport(format: "outlook" | "google" | "vcard") {
    setExportMenuOpen(false);
    // Trigger download via a hidden anchor — keeps the response binary-safe.
    const url = `/api/bids/${bidId}/contacts/export?format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function remove(id: number) {
    if (!confirm("Delete this contact?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/contacts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      if (editingId === id) {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
      }
      setReloadTick((t) => t + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading contacts…</p>
      </section>
    );
  }

  const isAddingNew = editingId === -1;
  const contactList = contacts ?? [];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Project Team Contacts ({contactList.length})
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Owner, design team, and your internal team. Flows into the handoff packet.
          </p>
        </div>
        {!isAddingNew && (
          <div className="flex items-center gap-2 relative">
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="Export contacts (project team + awarded subs)"
              >
                Export ▾
              </button>
              {exportMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-10 w-56 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  onMouseLeave={() => setExportMenuOpen(false)}
                >
                  <ExportMenuItem
                    label="Outlook CSV"
                    description="Import into classic Outlook or Outlook on the web"
                    onClick={() => downloadExport("outlook")}
                  />
                  <ExportMenuItem
                    label="Google Contacts CSV"
                    description="Import into Google Contacts (groups by project)"
                    onClick={() => downloadExport("google")}
                  />
                  <ExportMenuItem
                    label="vCard (.vcf)"
                    description="Universal — Apple Contacts, Outlook, Google, CRMs"
                    onClick={() => downloadExport("vcard")}
                  />
                  <p className="border-t border-zinc-100 px-3 py-2 text-[10px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    Includes project team + awarded subs.
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={startAdd}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              + Add Contact
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {isAddingNew && (
        <div className="border-b border-zinc-200 dark:border-zinc-700 bg-blue-50/40 dark:bg-blue-900/10">
          <ContactEditor
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={cancelEdit}
            isNew
          />
        </div>
      )}

      {contactList.length === 0 && !isAddingNew ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No project contacts yet.
          </p>
          <button
            onClick={startAdd}
            className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Add your first contact →
          </button>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {contactList.map((c) => {
            const isEditing = editingId === c.id;
            return (
              <div key={c.id}>
                {isEditing ? (
                  <div className="bg-blue-50/40 dark:bg-blue-900/10">
                    <ContactEditor
                      draft={draft}
                      setDraft={setDraft}
                      onSave={save}
                      onCancel={cancelEdit}
                      onDelete={() => remove(c.id)}
                    />
                  </div>
                ) : (
                  <ContactDisplay contact={c} onEdit={() => startEdit(c)} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Export menu item ───────────────────────────────────────────────────────

function ExportMenuItem({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors first:rounded-t-md"
    >
      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        {label}
      </div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
        {description}
      </div>
    </button>
  );
}

// ── Display row ────────────────────────────────────────────────────────────

function ContactDisplay({
  contact,
  onEdit,
}: {
  contact: ProjectContact;
  onEdit: () => void;
}) {
  const badge = ROLE_BADGE_STYLES[contact.role] ?? ROLE_BADGE_STYLES.OTHER;
  return (
    <button
      onClick={onEdit}
      className="w-full text-left px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
              {contact.name}
            </span>
            {contact.isPrimary && (
              <span className="rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                Primary
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge}`}
            >
              {ROLE_LABELS[contact.role]}
            </span>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {[contact.title, contact.company].filter(Boolean).join(" · ") || "—"}
          </div>
          <div className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {contact.email && <span>{contact.email}</span>}
            {contact.phone && <span>{contact.phone}</span>}
          </div>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">edit</span>
      </div>
    </button>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────

function ContactEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  onDelete,
  isNew,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  isNew?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Role">
          <select
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as ContactRole })}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name *">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Jane Smith"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Project Manager"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <Field label="Company">
          <input
            type="text"
            value={draft.company}
            onChange={(e) => setDraft({ ...draft, company: e.target.value })}
            placeholder="Acme Architects"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="jane@acme.com"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="(555) 123-4567"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Notes">
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
              placeholder="Internal notes…"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </Field>
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <input
            id="isPrimary"
            type="checkbox"
            checked={draft.isPrimary}
            onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })}
            className="rounded border-zinc-300 dark:border-zinc-600"
          />
          <label
            htmlFor="isPrimary"
            className="text-xs text-zinc-700 dark:text-zinc-300"
          >
            Primary contact for this role
          </label>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onSave}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {isNew ? "Add Contact" : "Save"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 dark:text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}
