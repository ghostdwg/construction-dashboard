"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import AddSubcontractorPanel from "./AddSubcontractorPanel";

type Trade = { id: number; name: string };

export default function SubcontractorFilters({ trades }: { trades: Trade[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [panelOpen, setPanelOpen] = useState(false);

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.replace(`/subcontractors?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search company…"
          defaultValue={searchParams.get("search") ?? ""}
          onChange={(e) => update("search", e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black w-48"
        />

        <select
          defaultValue={searchParams.get("tradeId") ?? ""}
          onChange={(e) => update("tradeId", e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value="">All Trades</option>
          {trades.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          defaultValue={searchParams.get("status") ?? ""}
          onChange={(e) => update("status", e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="preferred">Preferred</option>
          <option value="inactive">Inactive</option>
        </select>

        <button
          onClick={() => setPanelOpen(true)}
          className="ml-auto rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Add Subcontractor
        </button>
      </div>

      <AddSubcontractorPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />
    </>
  );
}
