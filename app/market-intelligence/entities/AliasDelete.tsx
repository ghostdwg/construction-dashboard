"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AliasDelete({
  entityId,
  aliasId,
  aliasLabel,
}: {
  entityId: string;
  aliasId: string;
  aliasLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Remove alias "${aliasLabel}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/market-intelligence/entities/${entityId}/aliases/${aliasId}`,
        { method: "DELETE" }
      );
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error ?? `HTTP ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded opacity-50 hover:opacity-100 disabled:opacity-20"
      style={{ color: "#ff8b66", border: "1px solid rgba(255,139,102,0.22)" }}
      title="Remove alias"
    >
      ×
    </button>
  );
}
