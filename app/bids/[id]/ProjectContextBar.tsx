"use client";

import Link from "next/link";
import StatusButton from "./StatusButton";
import {
  PURSUIT_SUBTABS,
  POST_AWARD_SUBTABS,
  CONSTRUCTION_SUBTABS,
  PURSUIT_KEYS,
  POST_AWARD_KEYS,
  CONSTRUCTION_KEYS,
  type TabKey,
} from "./tabConfig";

const STATUS_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  draft:     { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.04)",  border: "rgba(255,255,255,0.1)"  },
  active:    { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  leveling:  { color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)"   },
  submitted: { color: "#b8ceff",            bg: "rgba(126,167,255,0.1)",   border: "rgba(126,167,255,0.2)"  },
  awarded:   { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)"   },
  lost:      { color: "#ff968f",            bg: "var(--red-dim)",          border: "rgba(232,69,60,0.22)"   },
  cancelled: { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.03)",  border: "rgba(255,255,255,0.08)" },
};

type PhaseKey = "overview" | "pursue" | "deliver" | "closeout";

function resolvePhase(tab: string, isProject: boolean): PhaseKey {
  const t = tab as TabKey;
  if (t === "overview") return "overview";
  if (!isProject && PURSUIT_KEYS.has(t)) return "pursue";
  if (POST_AWARD_KEYS.has(t)) return "deliver";
  if (CONSTRUCTION_KEYS.has(t)) return "closeout";
  return "overview";
}

const PHASE_ENTRY: Record<PhaseKey, TabKey> = {
  overview: "overview",
  pursue:   "documents",
  deliver:  "handoff",
  closeout: "warranties",
};

export default function ProjectContextBar({
  bidId,
  bidName,
  location,
  status,
  workflowType,
  activeTab,
}: {
  bidId: number;
  bidName: string;
  location: string | null;
  status: string;
  workflowType: string;
  activeTab: string;
}) {
  const isProject   = workflowType === "PROJECT";
  const chip        = STATUS_COLOR[status] ?? STATUS_COLOR.draft;
  const activePhase = resolvePhase(activeTab, isProject);

  const subtabs =
    activePhase === "pursue" && !isProject ? PURSUIT_SUBTABS
    : activePhase === "deliver"            ? POST_AWARD_SUBTABS
    : activePhase === "closeout"           ? CONSTRUCTION_SUBTABS
    : null;

  return (
    <div
      className="sticky top-0 z-30 shrink-0 border-b border-[var(--line)]"
      style={{ background: "rgba(8,10,13,0.96)", backdropFilter: "blur(14px)" }}
    >
      {/* ── Row 1: project identity ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 h-[50px] border-b border-[var(--line)]">
        <Link
          href="/bids"
          className="font-mono text-[10px] uppercase tracking-[0.07em] shrink-0 transition-opacity"
          style={{ color: "var(--text-dim)", opacity: 0.5 }}
        >
          ← Projects
        </Link>

        <div className="w-px h-3.5 shrink-0" style={{ background: "var(--line-strong)" }} />

        <span
          className="text-[14px] font-[700] tracking-[-0.02em] truncate min-w-0"
          style={{ color: "var(--text)" }}
        >
          {bidName}
        </span>

        {location && (
          <span className="text-[12px] shrink-0 hidden md:block" style={{ color: "var(--text-dim)" }}>
            · {location}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {isProject && (
            <span
              className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded"
              style={{ background: "var(--signal-dim)", color: "var(--signal-soft)", border: "1px solid rgba(0,255,100,0.22)" }}
            >
              project
            </span>
          )}
          <span
            className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-0.5 rounded"
            style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}` }}
          >
            {status}
          </span>
          <StatusButton bidId={bidId} current={status} />
        </div>
      </div>

      {/* ── Row 2: phase switcher ─────────────────────────────────────────── */}
      <div className="flex items-stretch h-[42px] px-1 border-b border-[var(--line)]">
        <PhaseBtn
          href={`/bids/${bidId}?tab=overview`}
          label="Overview"
          active={activePhase === "overview"}
        />
        {!isProject && (
          <PhaseBtn
            href={`/bids/${bidId}?tab=${PHASE_ENTRY.pursue}`}
            label="Pursue"
            active={activePhase === "pursue"}
          />
        )}
        <PhaseBtn
          href={`/bids/${bidId}?tab=${PHASE_ENTRY.deliver}`}
          label="Deliver"
          active={activePhase === "deliver"}
        />
        <PhaseBtn
          href={`/bids/${bidId}?tab=${PHASE_ENTRY.closeout}`}
          label="Closeout"
          active={activePhase === "closeout"}
        />
      </div>

      {/* ── Row 3: sub-tabs for active phase ──────────────────────────────── */}
      {subtabs && (
        <div
          className="flex items-stretch h-[33px] px-2"
          style={{ overflowX: "auto", scrollbarWidth: "none" }}
        >
          {subtabs.map((t) => (
            <SubBtn
              key={t.key}
              href={`/bids/${bidId}?tab=${t.key}`}
              label={t.label}
              active={activeTab === t.key}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase button (Row 2) ──────────────────────────────────────────────────────

function PhaseBtn({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="relative flex items-center px-4 font-[600] text-[12px] tracking-[-0.01em] transition-colors whitespace-nowrap border-b-2"
      style={{
        borderColor: active ? "var(--signal)"   : "transparent",
        color:       active ? "var(--text)"     : "var(--text-dim)",
        background:  active ? "rgba(0,255,100,0.03)" : "transparent",
      }}
    >
      {active && (
        <span
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, var(--signal), transparent)", opacity: 0.5 }}
        />
      )}
      {label}
    </Link>
  );
}

// ── Sub-tab button (Row 3) ────────────────────────────────────────────────────

function SubBtn({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="shrink-0 flex items-center px-3 font-mono text-[9.5px] uppercase tracking-[0.08em] border-b transition-colors whitespace-nowrap"
      style={{
        borderColor: active ? "rgba(0,255,100,0.55)" : "transparent",
        color:       active ? "var(--text-soft)"     : "var(--text-dim)",
        background:  active ? "rgba(0,255,100,0.02)" : "transparent",
        marginBottom: "-1px",
      }}
    >
      {label}
    </Link>
  );
}
