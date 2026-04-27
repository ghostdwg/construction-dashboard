"use client";

import Link from "next/link";
import { type TabKey, PURSUIT_KEYS, POST_AWARD_KEYS, CONSTRUCTION_KEYS } from "./tabConfig";

export default function TabBar({
  bidId,
  bidStatus,
  workflowType = "BID",
  activeTab = "overview",
}: {
  bidId: number;
  bidStatus?: string;
  workflowType?: string;
  activeTab?: string;
}) {
  const active = activeTab as TabKey;
  const isProject   = workflowType === "PROJECT";
  const isPostAward = bidStatus === "awarded" || isProject;

  const isPursuitActive      = !isProject && PURSUIT_KEYS.has(active);
  const isPostAwardActive    = POST_AWARD_KEYS.has(active);
  const isConstructionActive = CONSTRUCTION_KEYS.has(active);

  return (
    <nav
      className="flex flex-col min-w-[200px] py-4 border-r border-[var(--line)]"
      style={{ background: "linear-gradient(180deg,rgba(12,14,19,0.92),rgba(9,11,15,0.96))" }}
    >
      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <Link
        href="/bids"
        className="flex items-center gap-3 px-4 pb-4 mb-1 border-b border-[var(--line)]"
      >
        <div className="flex items-center gap-2">
          <span style={{ fontWeight: 900, fontSize: "14px", letterSpacing: "-0.05em", color: "var(--text)" }}>
            NEURO
          </span>
          <div style={{ width: "1.5px", height: "14px", background: "var(--signal)", boxShadow: "0 0 8px rgba(0,255,100,0.4)" }} />
          <span style={{ fontWeight: 900, fontSize: "14px", letterSpacing: "-0.05em", color: "rgba(255,255,255,0.18)" }}>
            GLITCH
          </span>
        </div>
      </Link>

      {/* ── Overview ──────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-1">
        <p className="font-mono text-[9px] uppercase tracking-[0.11em] mb-1.5" style={{ color: "var(--text-dim)" }}>
          command
        </p>
      </div>
      <NavItem
        href={`/bids/${bidId}?tab=overview`}
        label="Overview"
        sub="status · intake · contacts"
        active={active === "overview"}
      />

      {/* ── Pursue ────────────────────────────────────────────────────── */}
      {!isProject && (
        <>
          <div className="px-3 pt-4 pb-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.11em] mb-1.5" style={{ color: "var(--text-dim)" }}>
              pursue
            </p>
          </div>
          <NavItem
            href={`/bids/${bidId}?tab=documents`}
            label="Pursuit"
            sub="docs · subs · scope · leveling"
            active={isPursuitActive}
            muted={isPostAward}
            meta={isPostAward ? undefined : "→"}
          />
        </>
      )}

      {/* ── Deliver ───────────────────────────────────────────────────── */}
      <div className="px-3 pt-4 pb-1">
        <p className="font-mono text-[9px] uppercase tracking-[0.11em] mb-1.5" style={{ color: "var(--text-dim)" }}>
          deliver
        </p>
      </div>
      <NavItem
        href={`/bids/${bidId}?tab=handoff`}
        label="Post-Award"
        sub="handoff · buyout · submittals"
        active={isPostAwardActive}
        meta={isPostAward && !isConstructionActive ? "●" : undefined}
        metaColor="var(--signal)"
      />

      {/* ── Closeout ──────────────────────────────────────────────────── */}
      <div className="px-3 pt-4 pb-1">
        <p className="font-mono text-[9px] uppercase tracking-[0.11em] mb-1.5" style={{ color: "var(--text-dim)" }}>
          closeout
        </p>
      </div>
      <NavItem
        href={`/bids/${bidId}?tab=warranties`}
        label="Construction"
        sub="warranties · inspections · closeout"
        active={isConstructionActive}
      />
    </nav>
  );
}

function NavItem({
  href, label, sub, active, muted = false, meta, metaColor,
}: {
  href: string;
  label: string;
  sub: string;
  active: boolean;
  muted?: boolean;
  meta?: string;
  metaColor?: string;
}) {
  return (
    <Link
      href={href}
      className="relative flex items-center justify-between gap-3 mx-2 mb-1 px-3 py-[11px] rounded-[7px] border transition-colors"
      style={
        active
          ? {
              background: "linear-gradient(180deg,rgba(0,255,100,0.08),rgba(0,255,100,0.04))",
              borderColor: "rgba(0,255,100,0.18)",
              color: "var(--text)",
              boxShadow: "inset 2px 0 0 var(--signal)",
            }
          : muted
          ? { borderColor: "transparent", color: "var(--text-dim)", background: "transparent" }
          : { borderColor: "transparent", color: "var(--text-soft)", background: "transparent" }
      }
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-[600] tracking-[-0.01em] truncate">{label}</span>
        <span className="text-[10px] truncate" style={{ color: active ? "rgba(0,255,100,0.5)" : "var(--text-dim)" }}>
          {sub}
        </span>
      </div>
      {meta && (
        <span
          className="font-mono text-[10px] shrink-0"
          style={{ color: metaColor ?? "var(--text-dim)" }}
        >
          {meta}
        </span>
      )}
    </Link>
  );
}
