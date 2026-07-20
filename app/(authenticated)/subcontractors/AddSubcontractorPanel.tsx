"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Trade = { id: number; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
};

const empty = {
  company: "",
  office: "",
  status: "active",
  notes: "",
  isUnion: false,
  isMWBE: false,
  isPreferred: false,
};

export default function AddSubcontractorPanel({ open, onClose }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState(empty);
  const [selectedTradeIds, setSelectedTradeIds] = useState<number[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && trades.length === 0) {
      fetch("/api/trades")
        .then((r) => r.json())
        .then(setTrades);
    }
  }, [open, trades.length]);

  function close() {
    setFields(empty);
    setSelectedTradeIds([]);
    onClose();
  }

  function set(key: keyof typeof empty) {
    return (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  function toggleTrade(id: number) {
    setSelectedTradeIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/subcontractors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, tradeIds: selectedTradeIds }),
    });
    close();
    setSubmitting(false);
    router.refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative z-10 w-full max-w-md bg-white shadow-xl flex flex-col h-full overflow-y-auto dark:bg-zinc-900">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-semibold">Add Subcontractor</h2>
          <button
            onClick={close}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none dark:text-zinc-500"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-5 flex-1">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Company Name *</label>
            <input
              autoFocus
              type="text"
              value={fields.company}
              onChange={set("company")}
              required
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Office / Location</label>
            <input
              type="text"
              value={fields.office}
              onChange={set("office")}
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Status</label>
            <select
              value={fields.status}
              onChange={set("status")}
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
            >
              <option value="active">Active</option>
              <option value="preferred">Preferred</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Trades</label>
            {trades.length === 0 ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Loading…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {trades.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTrade(t.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selectedTradeIds.includes(t.id)
                        ? "border-black bg-black text-white"
                        : "border-zinc-300 text-zinc-600 hover:border-zinc-500"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Tags</label>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={fields.isUnion as unknown as boolean}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, isUnion: e.target.checked }))
                  }
                  className="rounded"
                />
                Union
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={fields.isMWBE as unknown as boolean}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, isMWBE: e.target.checked }))
                  }
                  className="rounded"
                />
                MWBE
              </label>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                title="Internal only — never shown to subs or in exports"
              >
                <input
                  type="checkbox"
                  checked={fields.isPreferred as unknown as boolean}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, isPreferred: e.target.checked }))
                  }
                  className="rounded"
                />
                <span className="font-medium text-amber-700">★ Preferred</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Notes</label>
            <textarea
              value={fields.notes}
              onChange={set("notes")}
              rows={3}
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 mt-auto">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Add Subcontractor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
