"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import SubmitBidModal from "./SubmitBidModal";

const STATUSES = ["draft", "active", "leveling", "submitted", "awarded", "lost", "cancelled"];

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
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  async function setStatus(status: string) {
    if (status === current) { setOpen(false); return; }
    setOpen(false);

    // Special case: "submitted" triggers the submission modal flow
    if (status === "submitted") {
      setShowSubmitModal(true);
      return;
    }

    setLoading(true);
    await fetch(`/api/bids/${bidId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="font-mono text-[10px] uppercase tracking-[0.06em] px-3 py-1.5 rounded transition-colors disabled:opacity-40"
        style={{
          border: "1px solid var(--line-strong)",
          color: "var(--text-soft)",
          background: open ? "rgba(255,255,255,0.05)" : "transparent",
        }}
      >
        {loading ? "Saving…" : "Change ▾"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-1 w-36 rounded-[var(--radius)] border border-[var(--line-strong)] py-1 overflow-hidden"
            style={{ background: "var(--panel-3)", boxShadow: "var(--shadow)" }}
          >
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className="w-full text-left px-4 py-2 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors"
                style={{
                  color: s === current ? "var(--signal-soft)" : "var(--text-soft)",
                  background: "transparent",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {showSubmitModal && (
        <SubmitBidModal
          bidId={bidId}
          onClose={() => setShowSubmitModal(false)}
          onSubmitted={() => {
            setShowSubmitModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
