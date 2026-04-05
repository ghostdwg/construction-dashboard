"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES = ["draft", "active", "leveling", "awarded", "lost", "cancelled"];

export default function StatusButton({
  bidId,
  current,
}: {
  bidId: number;
  current: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function setStatus(status: string) {
    if (status === current) { setOpen(false); return; }
    setLoading(true);
    await fetch(`/api/bids/${bidId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm capitalize hover:bg-zinc-50 disabled:opacity-50"
      >
        {loading ? "Saving…" : `Status: ${current}`} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-zinc-200 bg-white shadow-md py-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`w-full text-left px-4 py-2 text-sm capitalize hover:bg-zinc-50 ${
                  s === current ? "font-semibold text-black" : "text-zinc-600"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
