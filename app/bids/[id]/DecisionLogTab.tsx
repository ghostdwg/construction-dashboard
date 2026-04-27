"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

type DecisionCategory =
  | "SCOPE"
  | "EXCLUSION"
  | "SUBSTITUTION"
  | "ASSUMPTION"
  | "RISK"
  | "VE"
  | "DESIGN"
  | "OTHER";

type DecisionStatus = "OPEN" | "SUPERSEDED" | "VOID";

type DecisionItem = {
  id: number;
  bidId: number;
  category: DecisionCategory;
  decision: string;
  rationale: string | null;
  madeBy: string | null;
  madeAt: string | null;
  impact: string | null;
  status: DecisionStatus;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

type DecisionFormState = {
  category: DecisionCategory;
  decision: string;
  rationale: string;
  madeBy: string;
  madeAt: string;
  impact: string;
  source: string;
  status: DecisionStatus;
};

const CATEGORIES: DecisionCategory[] = [
  "SCOPE",
  "EXCLUSION",
  "SUBSTITUTION",
  "ASSUMPTION",
  "RISK",
  "VE",
  "DESIGN",
  "OTHER",
];

const EMPTY_FORM: DecisionFormState = {
  category: "SCOPE",
  decision: "",
  rationale: "",
  madeBy: "",
  madeAt: "",
  impact: "",
  source: "",
  status: "OPEN",
};

const CATEGORY_CHIP: Record<DecisionCategory, { color: string; background: string; border: string }> = {
  SCOPE: {
    color: "var(--blue)",
    background: "color-mix(in srgb, var(--blue) 14%, transparent)",
    border: "var(--blue)",
  },
  EXCLUSION: {
    color: "var(--red)",
    background: "var(--red-dim)",
    border: "var(--red)",
  },
  SUBSTITUTION: {
    color: "var(--amber)",
    background: "var(--amber-dim)",
    border: "var(--amber)",
  },
  ASSUMPTION: {
    color: "var(--text-soft)",
    background: "color-mix(in srgb, var(--text-dim) 18%, transparent)",
    border: "var(--line-strong)",
  },
  RISK: {
    color: "var(--red)",
    background: "var(--red-dim)",
    border: "var(--red)",
  },
  VE: {
    color: "var(--signal-soft)",
    background: "var(--signal-dim)",
    border: "var(--signal)",
  },
  DESIGN: {
    color: "color-mix(in srgb, var(--blue) 65%, var(--red) 35%)",
    background:
      "color-mix(in srgb, color-mix(in srgb, var(--blue) 65%, var(--red) 35%) 18%, transparent)",
    border: "color-mix(in srgb, var(--blue) 65%, var(--red) 35%)",
  },
  OTHER: {
    color: "var(--text-soft)",
    background: "color-mix(in srgb, var(--text-dim) 18%, transparent)",
    border: "var(--line-strong)",
  },
};

const STATUS_CHIP: Record<DecisionStatus, { color: string; background: string; border: string }> = {
  OPEN: {
    color: "var(--signal-soft)",
    background: "var(--signal-dim)",
    border: "var(--signal)",
  },
  SUPERSEDED: {
    color: "var(--amber)",
    background: "var(--amber-dim)",
    border: "var(--amber)",
  },
  VOID: {
    color: "var(--red)",
    background: "var(--red-dim)",
    border: "var(--red)",
  },
};

function toDateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function toFormState(item: DecisionItem): DecisionFormState {
  return {
    category: item.category,
    decision: item.decision,
    rationale: item.rationale ?? "",
    madeBy: item.madeBy ?? "",
    madeAt: toDateInputValue(item.madeAt),
    impact: item.impact ?? "",
    source: item.source ?? "",
    status: item.status,
  };
}

function buildPayload(form: DecisionFormState) {
  return {
    category: form.category,
    decision: form.decision.trim(),
    rationale: form.rationale.trim() || null,
    madeBy: form.madeBy.trim() || null,
    madeAt: form.madeAt || null,
    impact: form.impact.trim() || null,
    source: form.source.trim() || null,
    status: form.status,
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function prettyCategory(category: DecisionCategory): string {
  return category.toLowerCase();
}

function CategoryChip({ category }: { category: DecisionCategory }) {
  const chip = CATEGORY_CHIP[category];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
      style={{
        color: chip.color,
        background: chip.background,
        border: `1px solid ${chip.border}`,
      }}
    >
      {prettyCategory(category)}
    </span>
  );
}

function StatusChip({ status }: { status: DecisionStatus }) {
  const chip = STATUS_CHIP[status];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.07em] whitespace-nowrap"
      style={{
        color: chip.color,
        background: chip.background,
        border: `1px solid ${chip.border}`,
      }}
    >
      {status.toLowerCase()}
    </span>
  );
}

function DecisionFormFields({
  form,
  onChange,
  showStatus,
}: {
  form: DecisionFormState;
  onChange: <K extends keyof DecisionFormState>(field: K, value: DecisionFormState[K]) => void;
  showStatus?: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Category
        </label>
        <select
          value={form.category}
          onChange={(event) => onChange("category", event.target.value as DecisionCategory)}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {showStatus && (
        <div>
          <label
            className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
            style={{ color: "var(--text-dim)" }}
          >
            Status
          </label>
          <select
            value={form.status}
            onChange={(event) => onChange("status", event.target.value as DecisionStatus)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          >
            {(["OPEN", "SUPERSEDED", "VOID"] as DecisionStatus[]).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={showStatus ? "md:col-span-2" : "md:col-span-2"}>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Decision
        </label>
        <textarea
          value={form.decision}
          onChange={(event) => onChange("decision", event.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          placeholder="What was decided?"
        />
      </div>

      <div className="md:col-span-2">
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Rationale
        </label>
        <textarea
          value={form.rationale}
          onChange={(event) => onChange("rationale", event.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          placeholder="Why was it decided?"
        />
      </div>

      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Made By
        </label>
        <input
          type="text"
          value={form.madeBy}
          onChange={(event) => onChange("madeBy", event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          placeholder="Name"
        />
      </div>

      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Date Made
        </label>
        <input
          type="date"
          value={form.madeAt}
          onChange={(event) => onChange("madeAt", event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
        />
      </div>

      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Impact
        </label>
        <input
          type="text"
          value={form.impact}
          onChange={(event) => onChange("impact", event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          placeholder="Budget, schedule, or quality implication"
        />
      </div>

      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{ color: "var(--text-dim)" }}
        >
          Source
        </label>
        <input
          type="text"
          value={form.source}
          onChange={(event) => onChange("source", event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          placeholder="Scope Review 04/14"
        />
      </div>
    </div>
  );
}

function DecisionEditPanel({
  form,
  error,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  form: DecisionFormState;
  error: string | null;
  saving: boolean;
  onChange: <K extends keyof DecisionFormState>(field: K, value: DecisionFormState[K]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-t border-[var(--line)] px-4 py-4" style={{ background: "var(--panel)" }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.09em]" style={{ color: "var(--text-dim)" }}>
          edit decision
        </p>
        {error && (
          <span className="text-[11px]" style={{ color: "var(--red)" }}>
            {error}
          </span>
        )}
      </div>

      <DecisionFormFields form={form} onChange={onChange} showStatus />

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em]"
          style={{ borderColor: "var(--line)", color: "var(--text-soft)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] disabled:opacity-50"
          style={{
            background: "var(--signal-dim)",
            borderColor: "var(--signal)",
            color: "var(--signal-soft)",
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function DecisionLogTab({ bidId }: { bidId: number }) {
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<DecisionCategory | "ALL">("ALL");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<DecisionFormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingDecisionId, setEditingDecisionId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<DecisionFormState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingDecisionId, setSavingDecisionId] = useState<number | null>(null);
  const [deletingDecisionId, setDeletingDecisionId] = useState<number | null>(null);

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/bids/${bidId}/decisions`);
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        decisions?: DecisionItem[];
      };

      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setDecisions(data.decisions ?? []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [bidId]);

  useEffect(() => {
    void fetchDecisions();
  }, [fetchDecisions]);

  function updateAddForm<K extends keyof DecisionFormState>(field: K, value: DecisionFormState[K]) {
    setAddForm((current) => ({ ...current, [field]: value }));
    setAddError(null);
  }

  function updateEditForm<K extends keyof DecisionFormState>(field: K, value: DecisionFormState[K]) {
    setEditForm((current) => (current ? { ...current, [field]: value } : current));
    setEditError(null);
  }

  function toggleEdit(item: DecisionItem) {
    if (editingDecisionId === item.id) {
      setEditingDecisionId(null);
      setEditForm(null);
      setEditError(null);
      return;
    }

    setEditingDecisionId(item.id);
    setEditForm(toFormState(item));
    setEditError(null);
  }

  async function submitAddDecision() {
    if (!addForm.decision.trim()) {
      setAddError("Decision is required");
      return;
    }

    setAdding(true);
    setAddError(null);

    const response = await fetch(`/api/bids/${bidId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(addForm)),
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setAddError(data.error ?? "Failed to save decision");
      setAdding(false);
      return;
    }

    setAddForm(EMPTY_FORM);
    setShowAddForm(false);
    setAdding(false);
    await fetchDecisions();
  }

  async function saveEditDecision(itemId: number) {
    if (!editForm || !editForm.decision.trim()) {
      setEditError("Decision is required");
      return;
    }

    setSavingDecisionId(itemId);
    setEditError(null);

    const response = await fetch(`/api/bids/${bidId}/decisions/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(editForm)),
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setEditError(data.error ?? "Failed to update decision");
      setSavingDecisionId(null);
      return;
    }

    setSavingDecisionId(null);
    setEditingDecisionId(null);
    setEditForm(null);
    await fetchDecisions();
  }

  async function deleteDecision(item: DecisionItem) {
    if (!window.confirm(`Delete decision "${item.decision}"?`)) return;

    setDeletingDecisionId(item.id);

    const response = await fetch(`/api/bids/${bidId}/decisions/${item.id}`, {
      method: "DELETE",
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Failed to delete decision");
      setDeletingDecisionId(null);
      return;
    }

    if (editingDecisionId === item.id) {
      setEditingDecisionId(null);
      setEditForm(null);
      setEditError(null);
    }

    setDeletingDecisionId(null);
    await fetchDecisions();
  }

  const filteredDecisions =
    activeCategory === "ALL"
      ? decisions
      : decisions.filter((item) => item.category === activeCategory);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Decision Log
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-dim)" }}>
            Pre-award decisions, exclusions, substitutions, and assumptions that carry into construction.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowAddForm((current) => !current);
            setAddError(null);
            if (showAddForm) {
              setAddForm(EMPTY_FORM);
            }
          }}
          className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em]"
          style={{
            borderColor: showAddForm ? "var(--signal)" : "var(--line)",
            background: showAddForm ? "var(--signal-dim)" : "transparent",
            color: showAddForm ? "var(--signal-soft)" : "var(--text-soft)",
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Decision"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveCategory("ALL")}
          className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.07em]"
          style={{
            borderColor: activeCategory === "ALL" ? "var(--signal)" : "var(--line)",
            background: activeCategory === "ALL" ? "var(--signal-dim)" : "transparent",
            color: activeCategory === "ALL" ? "var(--signal-soft)" : "var(--text-dim)",
          }}
        >
          all
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.07em]"
            style={{
              borderColor: activeCategory === category ? "var(--signal)" : "var(--line)",
              background: activeCategory === category ? "var(--signal-dim)" : "transparent",
              color: activeCategory === category ? "var(--signal-soft)" : "var(--text-dim)",
            }}
          >
            {category.toLowerCase()}
          </button>
        ))}
      </div>

      {showAddForm && (
        <section
          className="rounded-[var(--radius)] border p-4"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.09em]" style={{ color: "var(--text-dim)" }}>
              add decision
            </p>
            {addError && (
              <span className="text-[11px]" style={{ color: "var(--red)" }}>
                {addError}
              </span>
            )}
          </div>

          <DecisionFormFields form={addForm} onChange={updateAddForm} />

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setAddForm(EMPTY_FORM);
                setAddError(null);
              }}
              className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em]"
              style={{ borderColor: "var(--line)", color: "var(--text-soft)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitAddDecision()}
              disabled={adding}
              className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] disabled:opacity-50"
              style={{
                background: "var(--signal-dim)",
                borderColor: "var(--signal)",
                color: "var(--signal-soft)",
              }}
            >
              {adding ? "Saving..." : "Save"}
            </button>
          </div>
        </section>
      )}

      <section
        className="overflow-hidden rounded-[var(--radius)] border"
        style={{ borderColor: "var(--line)", background: "linear-gradient(180deg,var(--panel),var(--bg-2))" }}
      >
        {loading ? (
          <div className="px-4 py-10 text-center">
            <p className="font-mono text-[11px]" style={{ color: "var(--text-dim)" }}>
              Loading decisions...
            </p>
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm" style={{ color: "var(--red)" }}>
              {error}
            </p>
          </div>
        ) : filteredDecisions.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              {decisions.length === 0 ? "No decisions logged yet." : "No decisions match this filter."}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Category", "Decision", "Rationale", "Made By", "Date", "Source", "Status", "Actions"].map((label) => (
                  <th
                    key={label}
                    className="border-b px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.09em]"
                    style={{ borderColor: "var(--line)", color: "var(--text-dim)", background: "rgba(255,255,255,0.015)" }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDecisions.map((item) => {
                const isEditing = editingDecisionId === item.id && editForm !== null;

                return (
                  <Fragment key={item.id}>
                    <tr
                      className="border-b border-[var(--line)] last:border-b-0"
                      style={{ opacity: item.status === "VOID" ? 0.45 : 1 }}
                    >
                      <td className="px-4 py-3 align-top">
                        <CategoryChip category={item.category} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-[12px] leading-snug" style={{ color: "var(--text)" }}>
                          {item.decision}
                        </p>
                        {item.impact && (
                          <p className="mt-1 text-[10px]" style={{ color: "var(--text-dim)" }}>
                            Impact: {item.impact}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-[12px]" style={{ color: "var(--text-soft)" }}>
                        {item.rationale ?? <span style={{ color: "var(--text-dim)" }}>—</span>}
                      </td>
                      <td className="px-4 py-3 align-top text-[12px]" style={{ color: "var(--text-soft)" }}>
                        {item.madeBy ?? <span style={{ color: "var(--text-dim)" }}>—</span>}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-[11px]" style={{ color: "var(--text-soft)" }}>
                        {fmtDate(item.madeAt)}
                      </td>
                      <td className="px-4 py-3 align-top text-[12px]" style={{ color: "var(--text-soft)" }}>
                        {item.source ?? <span style={{ color: "var(--text-dim)" }}>—</span>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusChip status={item.status} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleEdit(item)}
                            className="font-mono text-[10px] uppercase tracking-[0.06em]"
                            style={{ color: isEditing ? "var(--signal-soft)" : "var(--text-dim)" }}
                          >
                            {isEditing ? "Close" : "Edit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteDecision(item)}
                            disabled={deletingDecisionId === item.id}
                            className="font-mono text-[10px] uppercase tracking-[0.06em] disabled:opacity-50"
                            style={{ color: "var(--red)" }}
                          >
                            {deletingDecisionId === item.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && editForm && (
                      <tr className="border-b border-[var(--line)]">
                        <td colSpan={8} className="p-0">
                          <DecisionEditPanel
                            form={editForm}
                            error={editError}
                            saving={savingDecisionId === item.id}
                            onChange={updateEditForm}
                            onSave={() => void saveEditDecision(item.id)}
                            onCancel={() => {
                              setEditingDecisionId(null);
                              setEditForm(null);
                              setEditError(null);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
