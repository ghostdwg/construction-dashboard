"use client";

// ──────────────────────────────────────────────────────────────────────────────
//  app/(authenticated)/market-intelligence/PromoteToPursuit.tsx
//  Market Intelligence → Pursuit promotion control.
//
//  Renders on both the MarketLead detail page and the market Project profile.
//  Every state the operator can be in is explicit:
//
//    already-promoted → link straight to the pursuit (no button)
//    ineligible       → disabled control + the reason
//    idle             → "Promote to Pursuit"
//    previewing       → server-authoritative confirm panel
//    submitting       → busy
//    success          → confirmation + direct navigation
//    error            → stable message, control stays usable
//
//  The preview is FETCHED, never computed here: the confirm panel must show
//  exactly what the service will write, so the mapping lives server-side only.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { pursuitHref } from "@/lib/services/pursuitPromotion/types";

type SourceKind = "LEAD" | "PROJECT";

type DraftFields = {
  projectName: string;
  location: string | null;
  buildingType: string | null;
  approxSqft: number | null;
};

type Preview = {
  eligible: boolean;
  reason: string | null;
  existingBidId: number | null;
  promotedOutOfScope: boolean;
  draft: DraftFields;
  notCarried: { field: string; value: string }[];
};

interface Props {
  sourceKind: SourceKind;
  sourceId: string;
  /** Server-rendered eligibility so the control is correct before any fetch. */
  initialEligible: boolean;
  /** Server-rendered reason when initialEligible is false. */
  initialReason?: string | null;
  /** Server-rendered existing pursuit, when already promoted and visible. */
  initialBidId?: number | null;
  /** Already promoted, but the pursuit belongs to someone else. */
  promotedOutOfScope?: boolean;
}

const DRAFT_LABELS: { key: keyof DraftFields; label: string }[] = [
  { key: "projectName", label: "Project name" },
  { key: "location", label: "Location" },
  { key: "buildingType", label: "Building type" },
  { key: "approxSqft", label: "Approx. sqft" },
];

export default function PromoteToPursuit({
  sourceKind,
  sourceId,
  initialEligible,
  initialReason = null,
  initialBidId = null,
  promotedOutOfScope = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ bidId: number; reused: boolean } | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const closePanel = useCallback(() => {
    setOpen(false);
    setErr(null);
    triggerRef.current?.focus();
  }, []);

  // Escape closes the confirm panel and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePanel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  async function openPreview() {
    setOpen(true);
    setErr(null);
    setLoadingPreview(true);
    try {
      const res = await fetch(
        `/api/market-intelligence/promote?sourceKind=${sourceKind}&sourceId=${encodeURIComponent(sourceId)}`
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErr(json?.message ?? `Could not load preview (HTTP ${res.status}).`);
      } else {
        setPreview(json.preview as Preview);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/market-intelligence/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKind, sourceId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErr(json?.message ?? `Promotion failed (HTTP ${res.status}).`);
        return;
      }
      setResult({ bidId: json.bidId as number, reused: Boolean(json.reused) });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <Panel tone="signal" role="status">
        <p className="text-sm" style={{ color: "var(--text)" }}>
          {result.reused
            ? "This source was already promoted — opening the existing pursuit."
            : "Draft pursuit created."}
        </p>
        <PursuitLink bidId={result.bidId} autoFocus />
      </Panel>
    );
  }

  // ── Already promoted, out of scope ─────────────────────────────────────────
  if (promotedOutOfScope) {
    return (
      <Panel tone="dim" role="status">
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Already promoted to a pursuit outside your access. Ask an administrator
          if you need it reassigned.
        </p>
      </Panel>
    );
  }

  // ── Already promoted, visible ──────────────────────────────────────────────
  if (initialBidId != null) {
    return (
      <Panel tone="signal" role="status">
        <p className="text-sm" style={{ color: "var(--text)" }}>
          Pursuit created from this {sourceKind === "LEAD" ? "lead" : "project"}.
        </p>
        <PursuitLink bidId={initialBidId} />
      </Panel>
    );
  }

  // ── Ineligible ─────────────────────────────────────────────────────────────
  if (!initialEligible) {
    return (
      <Panel tone="dim">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="self-start px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-[0.07em] opacity-40 cursor-not-allowed"
          style={{ border: "1px solid var(--line)", color: "var(--text-dim)" }}
        >
          Promote to Pursuit
        </button>
        <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
          {ineligibleMessage(initialReason, sourceKind)}
        </p>
      </Panel>
    );
  }

  // ── Eligible ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => void openPreview()}
        disabled={open || submitting}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="self-start px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-[0.07em] transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ border: "1px solid var(--signal)", color: "var(--signal)" }}
      >
        Promote to Pursuit
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Confirm promotion to pursuit"
          tabIndex={-1}
          className="flex flex-col gap-3 p-3 rounded outline-none"
          style={{ border: "1px solid var(--line)", background: "rgba(255,255,255,0.02)" }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
            Will create one draft pursuit with
          </p>

          {loadingPreview && (
            <p className="text-sm opacity-60" role="status">Loading preview…</p>
          )}

          {preview && !loadingPreview && (
            <>
              <dl className="grid grid-cols-2 gap-2">
                {DRAFT_LABELS.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
                      {label}
                    </dt>
                    <dd className="text-sm" style={{ color: "var(--text)" }}>
                      {preview.draft[key] ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>

              {preview.notCarried.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
                    Stays on the source
                  </p>
                  <ul className="text-[11px] space-y-0.5" style={{ color: "var(--text-dim)" }}>
                    {preview.notCarried.map((n) => (
                      <li key={n.field}>
                        {n.field}: {n.value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                Market analysis, scraped text and scoring stay here — the pursuit
                links back to this source instead of copying it.
              </p>
            </>
          )}

          {err && <ErrBox msg={err} />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || loadingPreview || !preview?.eligible}
              className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-[0.07em] hover:opacity-80 disabled:opacity-40"
              style={{ border: "1px solid var(--signal)", color: "var(--signal)" }}
            >
              {submitting ? "Creating…" : "Create draft pursuit"}
            </button>
            <button
              type="button"
              onClick={closePanel}
              disabled={submitting}
              className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-[0.07em] opacity-70 hover:opacity-100 disabled:opacity-40"
              style={{ border: "1px solid var(--line)", color: "var(--text-dim)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!open && err && <ErrBox msg={err} />}
    </div>
  );
}

function ineligibleMessage(reason: string | null, kind: SourceKind): string {
  switch (reason) {
    case "forbidden":
      return "Promoting to a pursuit requires the estimator or admin role.";
    case "ineligible_status":
      return kind === "LEAD"
        ? "Archived and dismissed leads cannot be promoted."
        : "Rejected, merged, abandoned and completed projects cannot be promoted.";
    case "not_found":
      return "This source is no longer available.";
    default:
      return "This source cannot be promoted right now.";
  }
}

function PursuitLink({ bidId, autoFocus }: { bidId: number; autoFocus?: boolean }) {
  return (
    <Link
      href={pursuitHref(bidId)}
      autoFocus={autoFocus}
      className="self-start px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-[0.07em] hover:opacity-80"
      style={{ border: "1px solid var(--signal)", color: "var(--signal)" }}
    >
      Open pursuit #{bidId} →
    </Link>
  );
}

function Panel({
  tone,
  role,
  children,
}: {
  tone: "signal" | "dim";
  role?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className="flex flex-col gap-2 p-3 rounded"
      style={{
        border: `1px solid ${tone === "signal" ? "var(--signal)" : "var(--line)"}`,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      {children}
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <p
      role="alert"
      className="text-[11px] px-2 py-1 rounded"
      style={{ border: "1px solid var(--color-danger, #ff6b6b)", color: "var(--color-danger, #ff6b6b)" }}
    >
      {msg}
    </p>
  );
}
