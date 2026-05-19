"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignalDetach({
  projectId,
  projectSignalId,
}: {
  projectId: string;
  projectSignalId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function detach() {
    if (!window.confirm("Detach this signal from the project? The row is preserved (soft-detach).")) return;
    const reason = window.prompt("Optional reason (recorded on the timeline):") ?? undefined;
    setBusy(true);
    try {
      const url = new URL(
        `/api/market-intelligence/projects/${projectId}/signals/${projectSignalId}`,
        window.location.origin
      );
      if (reason) url.searchParams.set("reason", reason);
      const res = await fetch(url.toString(), { method: "DELETE" });
      if (res.ok) router.refresh();
      else {
        const j = await res.json().catch(() => ({}));
        window.alert(j.error ?? `HTTP ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={detach}
      disabled={busy}
      className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded opacity-60 hover:opacity-100 disabled:opacity-20"
      style={{ color: "#ff8b66", border: "1px solid rgba(255,139,102,0.22)" }}
      title="Soft-detach this signal"
    >
      detach
    </button>
  );
}
