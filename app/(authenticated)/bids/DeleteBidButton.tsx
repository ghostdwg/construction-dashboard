"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteBidButton({
  bidId, projectName,
}: { bidId: number; projectName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete project "${projectName}"?\n\nThis permanently removes the project and all related records (subs, leveling, submittals, briefing, etc.).\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={handleDelete}
        disabled={busy}
        title="Delete project"
        className="gwx-nav-link font-mono text-[10px] uppercase tracking-[0.06em] px-2.5 py-1.5 rounded transition-colors disabled:opacity-40"
        style={{ border: "1px solid var(--line)", color: "var(--text-dim)" }}
      >
        {busy ? "…" : "✕"}
      </button>
      {error && (
        <span className="font-mono text-[10px]" style={{ color: "var(--red)" }} title={error}>
          err
        </span>
      )}
    </>
  );
}
