"use client";

// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/entities/EntityActions.tsx
//  Phase MI-4 — Operator action controls on the entity profile.
//
//  Verify · Reject · Unreject · Merge · Add Alias · Remove Alias
//
//  All actions call the governance API routes. Confirms before destructive
//  ops. Refreshes the page after success via router.refresh().
// ──────────────────────────────────────────────────────────────────────────────

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  entityId: string;
  canonicalName: string;
  reviewStatus: string;
}

export default function EntityActions({ entityId, canonicalName, reviewStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [showAlias, setShowAlias] = useState(false);

  async function doAction(action: "verify" | "reject" | "unreject", reason?: string) {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/market-intelligence/entities/${entityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function confirmAndDo(action: "verify" | "reject" | "unreject") {
    const verb = action === "verify" ? "Verify" : action === "reject" ? "Reject" : "Restore (un-reject)";
    const msg = `${verb} "${canonicalName}"?`;
    if (!window.confirm(msg)) return;
    if (action === "reject") {
      const reason = window.prompt("Optional reason (added to entity notes):") ?? undefined;
      void doAction(action, reason || undefined);
    } else {
      void doAction(action);
    }
  }

  const canVerify = reviewStatus !== "VERIFIED" && reviewStatus !== "REJECTED";
  const canReject = reviewStatus !== "REJECTED";
  const canUnreject = reviewStatus === "REJECTED";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canVerify && (
          <ActionButton
            label="Verify"
            tone="signal"
            disabled={busy !== null}
            onClick={() => confirmAndDo("verify")}
            busy={busy === "verify"}
          />
        )}
        {canReject && (
          <ActionButton
            label="Reject"
            tone="warn"
            disabled={busy !== null}
            onClick={() => confirmAndDo("reject")}
            busy={busy === "reject"}
          />
        )}
        {canUnreject && (
          <ActionButton
            label="Un-reject"
            tone="amber"
            disabled={busy !== null}
            onClick={() => confirmAndDo("unreject")}
            busy={busy === "unreject"}
          />
        )}
        <ActionButton
          label="Merge into…"
          tone="amber"
          disabled={busy !== null || reviewStatus === "REJECTED"}
          onClick={() => setShowMerge(true)}
        />
        <ActionButton
          label="Add alias"
          tone="neutral"
          disabled={busy !== null}
          onClick={() => setShowAlias(true)}
        />
      </div>
      {err && (
        <div
          className="font-mono text-[11px] px-2 py-1 rounded"
          style={{ color: "#ff8b66", background: "rgba(255,139,102,0.06)", border: "1px solid rgba(255,139,102,0.22)" }}
        >
          {err}
        </div>
      )}
      {showMerge && (
        <MergePanel
          entityId={entityId}
          canonicalName={canonicalName}
          onClose={() => setShowMerge(false)}
          onSuccess={() => {
            setShowMerge(false);
            router.refresh();
          }}
        />
      )}
      {showAlias && (
        <AliasPanel
          entityId={entityId}
          onClose={() => setShowAlias(false)}
          onSuccess={() => {
            setShowAlias(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Buttons / panels ────────────────────────────────────────────────────────

function ActionButton({
  label,
  tone,
  disabled,
  onClick,
  busy,
}: {
  label: string;
  tone: "signal" | "warn" | "amber" | "neutral";
  disabled: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  const styles: Record<typeof tone, { color: string; bg: string; border: string }> = {
    signal: { color: "var(--signal-soft)", bg: "var(--signal-dim)", border: "rgba(45,123,255,0.22)" },
    warn:   { color: "#ff8b66",            bg: "rgba(255,139,102,0.06)", border: "rgba(255,139,102,0.22)" },
    amber:  { color: "#ffcc72",            bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)" },
    neutral:{ color: "var(--text-soft)",   bg: "rgba(255,255,255,0.04)", border: "var(--line)" },
  };
  const s = styles[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.07em] rounded-md disabled:opacity-40"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {busy ? "..." : label}
    </button>
  );
}

interface MergeCandidate {
  id: string;
  canonicalName: string;
  entityType: string;
}

function MergePanel({
  entityId,
  canonicalName,
  onClose,
  onSuccess,
}: {
  entityId: string;
  canonicalName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<{ aliasesToMove: number; relationshipsToRepoint: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function dryRun() {
    setErr(null);
    setBusy(true);
    setPlan(null);
    try {
      const res = await fetch(`/api/market-intelligence/entities/${entityId}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetEntityId: target, dryRun: true }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
      } else {
        setPlan(body.data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    if (!window.confirm(`Merge "${canonicalName}" into target ${target}? This rewires ${plan.relationshipsToRepoint} relationship(s) and ${plan.aliasesToMove} alias(es).`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/market-intelligence/entities/${entityId}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetEntityId: target }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
      } else {
        onSuccess();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="p-3 rounded-md flex flex-col gap-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">Merge into another entity</div>
      <input
        type="text"
        placeholder="target entity ID (cuid)"
        value={target}
        onChange={(e) => {
          setTarget(e.target.value);
          setPlan(null);
        }}
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      />
      <div className="text-[11px] opacity-60">
        Find the target ID from another entity's profile URL (/market-intelligence/entities/[id]).
      </div>
      <div className="flex items-center gap-2">
        <ActionButton label="Preview merge" tone="neutral" disabled={busy || !target} onClick={dryRun} busy={busy && !plan} />
        {plan && (
          <ActionButton label="Confirm merge" tone="warn" disabled={busy} onClick={confirm} busy={busy} />
        )}
        <ActionButton label="Cancel" tone="neutral" disabled={busy} onClick={onClose} />
      </div>
      {plan && (
        <div className="font-mono text-[11px] opacity-80">
          Will move {plan.aliasesToMove} alias(es) and repoint {plan.relationshipsToRepoint} relationship(s).
          Source entity will be marked REJECTED with a forwarding note.
        </div>
      )}
      {err && (
        <div
          className="font-mono text-[11px] px-2 py-1 rounded"
          style={{ color: "#ff8b66", background: "rgba(255,139,102,0.06)", border: "1px solid rgba(255,139,102,0.22)" }}
        >
          {err}
        </div>
      )}
    </div>
  );
}

function AliasPanel({
  entityId,
  onClose,
  onSuccess,
}: {
  entityId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [alias, setAlias] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!alias.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/market-intelligence/entities/${entityId}/aliases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: alias.trim(), confidence: "HIGH" }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
      } else {
        onSuccess();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="p-3 rounded-md flex flex-col gap-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">Add a verified alias</div>
      <input
        type="text"
        placeholder='e.g. "Hubbell" or "Hubbell Realty Co."'
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      />
      <div className="flex items-center gap-2">
        <ActionButton label="Add alias" tone="signal" disabled={busy || !alias.trim()} onClick={add} busy={busy} />
        <ActionButton label="Cancel" tone="neutral" disabled={busy} onClick={onClose} />
      </div>
      {err && (
        <div
          className="font-mono text-[11px] px-2 py-1 rounded"
          style={{ color: "#ff8b66", background: "rgba(255,139,102,0.06)", border: "1px solid rgba(255,139,102,0.22)" }}
        >
          {err}
        </div>
      )}
    </div>
  );
}
