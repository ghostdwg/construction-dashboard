"use client";

// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/projects/ProjectActions.tsx
//  Phase MI-6 PR3 — Operator action controls on project profile.
// ──────────────────────────────────────────────────────────────────────────────

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  projectId: string;
  workingTitle: string;
  reviewStatus: string;
  lifecycleState: string;
}

const TRANSITION_TARGETS = [
  "EMERGING",
  "EARLY_SIGNAL",
  "PRE_ENTITLEMENT",
  "ENTITLEMENT",
  "SITE_PREP",
  "PRE_CONSTRUCTION",
  "ACTIVE_CONSTRUCTION",
  "STALLED",
  "ABANDONED",
  "COMPLETED",
] as const;

export default function ProjectActions({
  projectId,
  workingTitle,
  reviewStatus,
  lifecycleState,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showTransition, setShowTransition] = useState(false);

  async function patch(body: Record<string, unknown>, key: string): Promise<void> {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch(`/api/market-intelligence/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function confirmReject() {
    if (!window.confirm(`Reject "${workingTitle}"? This marks the aggregate as a wrong cluster.`)) return;
    const reason = window.prompt("Optional reason (added to project notes):") ?? undefined;
    void patch({ action: "reject", reason: reason || undefined }, "reject");
  }

  function confirmStall() {
    if (!window.confirm(`Mark "${workingTitle}" as STALLED?`)) return;
    const reason = window.prompt("Optional reason:") ?? undefined;
    void patch({ action: "stall", reason: reason || undefined }, "stall");
  }

  function confirmVerify() {
    if (!window.confirm(`Verify "${workingTitle}"?`)) return;
    void patch({ action: "verify" }, "verify");
  }

  const canVerify = reviewStatus !== "VERIFIED" && reviewStatus !== "REJECTED" && reviewStatus !== "MERGED";
  const canReject = reviewStatus !== "REJECTED" && reviewStatus !== "MERGED";
  const canStall = lifecycleState !== "STALLED" && lifecycleState !== "ABANDONED" && lifecycleState !== "COMPLETED";
  const canMerge = reviewStatus !== "REJECTED" && reviewStatus !== "MERGED";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canVerify && (
          <Button label="Verify" tone="signal" disabled={busy !== null} onClick={confirmVerify} busy={busy === "verify"} />
        )}
        {canReject && (
          <Button label="Reject" tone="warn" disabled={busy !== null} onClick={confirmReject} busy={busy === "reject"} />
        )}
        {canStall && (
          <Button label="Mark stalled" tone="amber" disabled={busy !== null} onClick={confirmStall} busy={busy === "stall"} />
        )}
        <Button label="Change state…" tone="neutral" disabled={busy !== null} onClick={() => setShowTransition((v) => !v)} />
        {canMerge && (
          <Button label="Merge into…" tone="amber" disabled={busy !== null} onClick={() => setShowMerge((v) => !v)} />
        )}
        <Button label="Add note" tone="neutral" disabled={busy !== null} onClick={() => setShowNote((v) => !v)} />
      </div>
      {err && <ErrBox msg={err} />}
      {showTransition && (
        <TransitionPanel
          current={lifecycleState}
          onSubmit={(toState, reason, override) => {
            setShowTransition(false);
            void patch({ action: "transition", toState, reason, override }, "transition");
          }}
          onCancel={() => setShowTransition(false)}
        />
      )}
      {showMerge && (
        <MergePanel
          projectId={projectId}
          workingTitle={workingTitle}
          onClose={() => setShowMerge(false)}
          onDone={() => {
            setShowMerge(false);
            router.refresh();
          }}
        />
      )}
      {showNote && (
        <NotePanel
          onSubmit={(note) => {
            setShowNote(false);
            void patch({ action: "addNote", note }, "addNote");
          }}
          onCancel={() => setShowNote(false)}
        />
      )}
    </div>
  );
}

function Button({
  label,
  tone,
  onClick,
  disabled,
  busy,
}: {
  label: string;
  tone: "signal" | "warn" | "amber" | "neutral";
  onClick: () => void;
  disabled: boolean;
  busy?: boolean;
}) {
  const styles: Record<typeof tone, { color: string; bg: string; border: string }> = {
    signal: { color: "var(--signal-soft)", bg: "var(--signal-dim)", border: "rgba(0,255,100,0.22)" },
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

function ErrBox({ msg }: { msg: string }) {
  return (
    <div
      className="font-mono text-[11px] px-2 py-1 rounded"
      style={{ color: "#ff8b66", background: "rgba(255,139,102,0.06)", border: "1px solid rgba(255,139,102,0.22)" }}
    >
      {msg}
    </div>
  );
}

function TransitionPanel({
  current,
  onSubmit,
  onCancel,
}: {
  current: string;
  onSubmit: (toState: string, reason: string, override: boolean) => void;
  onCancel: () => void;
}) {
  const [toState, setToState] = useState(current);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  return (
    <div className="p-3 rounded-md flex flex-col gap-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">Change lifecycle state</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={toState}
          onChange={(e) => setToState(e.target.value)}
          className="px-2 py-1 rounded-md font-mono text-[12px]"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
        >
          {TRANSITION_TARGETS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          override
        </label>
      </div>
      <input
        type="text"
        placeholder="reason (recorded on transition)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      />
      <div className="flex items-center gap-2">
        <Button
          label="Apply"
          tone="signal"
          disabled={!reason.trim() || toState === current}
          onClick={() => onSubmit(toState, reason.trim(), override)}
        />
        <Button label="Cancel" tone="neutral" disabled={false} onClick={onCancel} />
      </div>
      <div className="font-mono text-[10px] opacity-60">
        Without override, only forward transitions through the funnel are allowed (or sideways to STALLED/ABANDONED).
      </div>
    </div>
  );
}

function MergePanel({
  projectId,
  workingTitle,
  onClose,
  onDone,
}: {
  projectId: string;
  workingTitle: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<{ signalsToMove: number; entitiesToMove: number; parcelsToMove: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function preview() {
    setErr(null);
    setBusy(true);
    setPlan(null);
    try {
      const res = await fetch(`/api/market-intelligence/projects/${projectId}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetProjectId: target, dryRun: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setErr(json.error ?? `HTTP ${res.status}`);
      else setPlan(json.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!plan) return;
    if (
      !window.confirm(
        `Merge "${workingTitle}" into ${target}? Moves ${plan.signalsToMove} signals, ` +
          `${plan.entitiesToMove} entities, ${plan.parcelsToMove} parcels. Source becomes MERGED.`
      )
    ) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/market-intelligence/projects/${projectId}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetProjectId: target }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setErr(json.error ?? `HTTP ${res.status}`);
      else onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3 rounded-md flex flex-col gap-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">Merge this project into another</div>
      <input
        type="text"
        placeholder="target project ID (cuid)"
        value={target}
        onChange={(e) => { setTarget(e.target.value); setPlan(null); }}
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      />
      <div className="text-[11px] opacity-60">
        Find the target's ID from its profile URL (/market-intelligence/projects/[id]).
      </div>
      <div className="flex items-center gap-2">
        <Button label="Preview merge" tone="neutral" disabled={busy || !target} onClick={preview} busy={busy && !plan} />
        {plan && (
          <Button label="Confirm merge" tone="warn" disabled={busy} onClick={execute} busy={busy} />
        )}
        <Button label="Cancel" tone="neutral" disabled={busy} onClick={onClose} />
      </div>
      {plan && (
        <div className="font-mono text-[11px] opacity-80">
          Will move {plan.signalsToMove} signal(s), {plan.entitiesToMove} entity attachment(s), {plan.parcelsToMove} parcel(s).
          Source becomes reviewStatus=MERGED with mergedIntoProjectId forwarding pointer; no rows deleted.
        </div>
      )}
      {err && <ErrBox msg={err} />}
    </div>
  );
}

function NotePanel({
  onSubmit,
  onCancel,
}: {
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="p-3 rounded-md flex flex-col gap-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-80">Add operator note</div>
      <textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="The note appears on the project's timeline view."
        className="px-2 py-1 rounded-md font-mono text-[12px]"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--line)", color: "var(--text)" }}
      />
      <div className="flex items-center gap-2">
        <Button label="Save note" tone="signal" disabled={!note.trim()} onClick={() => onSubmit(note.trim())} />
        <Button label="Cancel" tone="neutral" disabled={false} onClick={onCancel} />
      </div>
    </div>
  );
}
