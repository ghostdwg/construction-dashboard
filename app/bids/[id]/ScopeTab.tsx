"use client";

import { useEffect, useState } from "react";

type Trade = { id: number; name: string };
type ScopeItem = {
  id: number;
  description: string;
  inclusion: boolean;
  specSection: string | null;
  drawingRef: string | null;
  notes: string | null;
  riskFlag: boolean;
  restricted: boolean;
  tradeId: number | null;
  trade: Trade | null;
};
type ScopeResponse = {
  byTrade: Record<string, { trade: Trade; items: ScopeItem[] }>;
  unassigned: ScopeItem[];
};

type AddFormState = {
  description: string;
  tradeId: number | "";
  inclusion: boolean;
  specSection: string;
  drawingRef: string;
  notes: string;
  riskFlag: boolean;
};

const EMPTY_FORM: AddFormState = {
  description: "",
  tradeId: "",
  inclusion: true,
  specSection: "",
  drawingRef: "",
  notes: "",
  riskFlag: false,
};

export default function ScopeTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<ScopeResponse>({ byTrade: {}, unassigned: [] });
  const [bidTrades, setBidTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  // Which trade section has the add form open (null = unassigned section, undefined = none)
  const [openForTrade, setOpenForTrade] = useState<number | null | undefined>(undefined);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/bids/${bidId}/scope`).then((r) => r.json()),
      fetch(`/api/bids/${bidId}`).then((r) => r.json()),
    ])
      .then(([scopeData, bidData]: [ScopeResponse, { bidTrades: { trade: Trade }[] }]) => {
        setData({
          byTrade: scopeData?.byTrade ?? {},
          unassigned: scopeData?.unassigned ?? [],
        });
        setBidTrades(bidData.bidTrades?.map((bt) => bt.trade) ?? []);
        setLoading(false);
      })
      .catch((e: Error) => {
        setFetchError(e.message);
        setLoading(false);
      });
  }, [bidId]);

  function openAddForm(tradeId: number | null) {
    setOpenForTrade(tradeId);
    setForm({ ...EMPTY_FORM, tradeId: tradeId ?? "" });
  }

  function closeAddForm() {
    setOpenForTrade(undefined);
    setForm(EMPTY_FORM);
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) return;
    setSubmitting(true);

    const res = await fetch(`/api/bids/${bidId}/scope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: form.description,
        tradeId: form.tradeId || undefined,
        inclusion: form.inclusion,
        specSection: form.specSection || undefined,
        drawingRef: form.drawingRef || undefined,
        notes: form.notes || undefined,
        riskFlag: form.riskFlag,
      }),
    });

    const newItem: ScopeItem = await res.json();
    setData((prev) => {
      if (newItem.tradeId && newItem.trade) {
        const key = String(newItem.tradeId);
        const existing = prev.byTrade[key];
        return {
          ...prev,
          byTrade: {
            ...prev.byTrade,
            [key]: {
              trade: newItem.trade,
              items: existing ? [...existing.items, newItem] : [newItem],
            },
          },
        };
      } else {
        return { ...prev, unassigned: [...prev.unassigned, newItem] };
      }
    });

    closeAddForm();
    setSubmitting(false);
  }

  async function removeItem(item: ScopeItem) {
    setRemoving(item.id);
    await fetch(`/api/bids/${bidId}/scope/${item.id}`, { method: "DELETE" });
    setData((prev) => {
      if (item.tradeId) {
        const key = String(item.tradeId);
        const group = prev.byTrade[key];
        if (!group) return prev;
        const updated = group.items.filter((i) => i.id !== item.id);
        if (updated.length === 0) {
          const { [key]: _removed, ...rest } = prev.byTrade;
          return { ...prev, byTrade: rest };
        }
        return {
          ...prev,
          byTrade: { ...prev.byTrade, [key]: { ...group, items: updated } },
        };
      } else {
        return { ...prev, unassigned: prev.unassigned.filter((i) => i.id !== item.id) };
      }
    });
    setRemoving(null);
  }

  if (!data || !data.byTrade) return <div>Loading...</div>;

  // Derived counts
  const allItems = [
    ...Object.values(data.byTrade ?? {}).flatMap((g) => g.items),
    ...(data.unassigned ?? []),
  ];
  const totalCount = allItems.length;
  const assignedCount = allItems.filter((i) => i.tradeId).length;
  const unassignedCount = data.unassigned.length;
  const riskCount = allItems.filter((i) => i.riskFlag).length;

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (fetchError) return <p className="text-sm text-red-500">Error: {fetchError}</p>;

  return (
    <div className="flex flex-col gap-8">
      {/* Summary bar */}
      <div className="flex gap-6 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm">
        <span className="text-zinc-700">
          <span className="font-semibold">{totalCount}</span>{" "}
          <span className="text-zinc-500">total</span>
        </span>
        <span className="text-zinc-700">
          <span className="font-semibold">{assignedCount}</span>{" "}
          <span className="text-zinc-500">assigned</span>
        </span>
        {unassignedCount > 0 && (
          <span className="text-zinc-700">
            <span className="font-semibold">{unassignedCount}</span>{" "}
            <span className="text-zinc-500">unassigned</span>
          </span>
        )}
        {riskCount > 0 && (
          <span className="text-amber-700">
            <span className="font-semibold">{riskCount}</span>{" "}
            <span className="text-amber-600">risk flag{riskCount !== 1 ? "s" : ""}</span>
          </span>
        )}
      </div>

      {/* Trade sections */}
      {Object.entries(data.byTrade).map(([key, group]) => (
        <TradeSection
          key={key}
          trade={group.trade}
          items={group.items}
          removing={removing}
          onRemove={removeItem}
          isAddOpen={openForTrade === group.trade.id}
          onOpenAdd={() => openAddForm(group.trade.id)}
          onCloseAdd={closeAddForm}
          form={form}
          setForm={setForm}
          onSubmitAdd={submitAdd}
          submitting={submitting}
          bidTrades={bidTrades}
        />
      ))}

      {/* Unassigned section */}
      <TradeSection
        trade={null}
        items={data.unassigned}
        removing={removing}
        onRemove={removeItem}
        isAddOpen={openForTrade === null}
        onOpenAdd={() => openAddForm(null)}
        onCloseAdd={closeAddForm}
        form={form}
        setForm={setForm}
        onSubmitAdd={submitAdd}
        submitting={submitting}
        bidTrades={bidTrades}
      />
    </div>
  );
}

function TradeSection({
  trade,
  items,
  removing,
  onRemove,
  isAddOpen,
  onOpenAdd,
  onCloseAdd,
  form,
  setForm,
  onSubmitAdd,
  submitting,
  bidTrades,
}: {
  trade: Trade | null;
  items: ScopeItem[];
  removing: number | null;
  onRemove: (item: ScopeItem) => void;
  isAddOpen: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  form: AddFormState;
  setForm: React.Dispatch<React.SetStateAction<AddFormState>>;
  onSubmitAdd: (e: React.FormEvent) => void;
  submitting: boolean;
  bidTrades: Trade[];
}) {
  const label = trade ? trade.name : "Unassigned";

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          {label}
          <span className="ml-2 font-normal text-zinc-400">({items.length})</span>
        </h3>
        {!isAddOpen && (
          <button
            onClick={onOpenAdd}
            className="text-xs text-zinc-500 hover:text-zinc-900 border border-zinc-300 rounded px-2 py-0.5 hover:border-zinc-400"
          >
            + Add item
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="border border-zinc-200 rounded-md overflow-hidden mb-3">
          <table className="w-full text-sm">
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <p className="text-sm leading-snug">{item.description}</p>
                      {item.riskFlag && (
                        <span
                          title="Risk flag"
                          className="shrink-0 mt-0.5 text-amber-500"
                          aria-label="Risk flag"
                        >
                          ⚠
                        </span>
                      )}
                      {item.restricted && (
                        <span
                          title="Restricted"
                          className="shrink-0 mt-0.5 text-zinc-400"
                          aria-label="Restricted"
                        >
                          🔒
                        </span>
                      )}
                    </div>
                    {(item.specSection || item.drawingRef) && (
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {item.specSection && <span>Spec {item.specSection}</span>}
                        {item.specSection && item.drawingRef && <span className="mx-1">·</span>}
                        {item.drawingRef && <span>Dwg {item.drawingRef}</span>}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-zinc-400 mt-0.5 italic">{item.notes}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 w-32 text-right align-top">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          item.inclusion
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-600"
                        }`}
                      >
                        {item.inclusion ? "Included" : "Excluded"}
                      </span>
                      <button
                        onClick={() => onRemove(item)}
                        disabled={removing === item.id}
                        className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                      >
                        {removing === item.id ? "…" : "Remove"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAddOpen && (
        <form
          onSubmit={onSubmitAdd}
          className="border border-zinc-200 rounded-md p-4 bg-zinc-50 flex flex-col gap-3"
        >
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Scope item description (required)"
            rows={2}
            required
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.tradeId}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  tradeId: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                }))
              }
              className="rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">No trade (unassigned)</option>
              {bidTrades.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {/* Inclusion toggle */}
            <div className="flex rounded border border-zinc-300 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, inclusion: true }))}
                className={`flex-1 py-2 text-center ${
                  form.inclusion
                    ? "bg-green-600 text-white"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                Included
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, inclusion: false }))}
                className={`flex-1 py-2 text-center border-l border-zinc-300 ${
                  !form.inclusion
                    ? "bg-red-500 text-white"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                Excluded
              </button>
            </div>

            <input
              value={form.specSection}
              onChange={(e) => setForm((f) => ({ ...f, specSection: e.target.value }))}
              placeholder="Spec section (e.g. 26 00 00)"
              className="rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <input
              value={form.drawingRef}
              onChange={(e) => setForm((f) => ({ ...f, drawingRef: e.target.value }))}
              placeholder="Drawing ref (e.g. E-101)"
              className="rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes (optional)"
            className="rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
              <input
                type="checkbox"
                checked={form.riskFlag}
                onChange={(e) => setForm((f) => ({ ...f, riskFlag: e.target.checked }))}
                className="rounded"
              />
              Risk flag
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCloseAdd}
                className="rounded px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 border border-zinc-300 hover:border-zinc-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.description.trim()}
                className="rounded bg-black px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                {submitting ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </form>
      )}

      {items.length === 0 && !isAddOpen && (
        <p className="text-xs text-zinc-400 italic">No items.</p>
      )}
    </section>
  );
}
