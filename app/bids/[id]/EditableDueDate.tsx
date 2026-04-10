"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  bidId: number;
  initialDueDate: string | null;
};

function toInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // YYYY-MM-DD for native date input
  return d.toISOString().slice(0, 10);
}

function fmtDisplay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export default function EditableDueDate({ bidId, initialDueDate }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toInputValue(initialDueDate));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/bids/${bidId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value || null }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setValue(toInputValue(initialDueDate));
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-sm text-zinc-700 hover:text-blue-600 cursor-pointer text-left"
        title="Click to edit"
      >
        {fmtDisplay(initialDueDate)} <span className="text-xs text-zinc-300">✎</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        className="rounded-md bg-white border border-zinc-300 px-2 py-1 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      <button
        onClick={save}
        disabled={saving}
        className="rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        onClick={cancel}
        disabled={saving}
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-500"
      >
        Cancel
      </button>
    </div>
  );
}
