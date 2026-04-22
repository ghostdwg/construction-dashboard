"use client";

import Link from "next/link";
import StatusButton from "./StatusButton";
import {
  PURSUIT_SUBTABS,
  POST_AWARD_SUBTABS,
  CONSTRUCTION_SUBTABS,
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
  const isProject = workflowType === "PROJECT";
  const chip = STATUS_COLOR[status] ?? STATUS_COLOR.draft;

  return (
    <div
      className="sticky top-0 z-30 border-b border-[var(--line)] shrink-0"
      style={{ background: "rgba(8,10,13,0.96)", backdropFilter: "blur(14px)" }}
    >
      {/* ── Row 1: project identity ────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 h-[50px] border-b border-[var(--line)]">
        <Link
          href="/bids"
          className="font-mono text-[10px] uppercase tracking-[0.07em] shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-dim)" }}
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

      {/* ── Row 2: tab strip ───────────────────────────────────────────── */}
      <div
        className="flex items-stretch h-[34px] overflow-x-auto"
        style={{ scrollbarWidth: "none", paddingLeft: "20px" }}
      >
        {/* Overview */}
        <TabBtn href={`/bids/${bidId}?tab=overview`} label="OVERVIEW" active={activeTab === "overview"} />

        {/* Pursue section */}
        {!isProject && (
          <>
            <SectionDivider label="PURSUE" />
            {PURSUIT_SUBTABS.map((t) => (
              <TabBtn
                key={t.key}
                href={`/bids/${bidId}?tab=${t.key}`}
                label={t.label}
                active={activeTab === t.key}
              />
            ))}
          </>
        )}

        {/* Deliver section */}
        <SectionDivider label="DELIVER" />
        {POST_AWARD_SUBTABS.map((t) => (
          <TabBtn
            key={t.key}
            href={`/bids/${bidId}?tab=${t.key}`}
            label={t.label}
            active={activeTab === t.key}
          />
        ))}

        {/* Closeout section */}
        <SectionDivider label="CLOSEOUT" />
        {CONSTRUCTION_SUBTABS.map((t) => (
          <TabBtn
            key={t.key}
            href={`/bids/${bidId}?tab=${t.key}`}
            label={t.label}
            active={activeTab === t.key}
          />
        ))}

        <div className="w-4 shrink-0" />
      </div>
    </div>
  );
}

function TabBtn({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="shrink-0 flex items-center px-3 font-mono text-[10px] uppercase tracking-[0.07em] border-b-2 transition-colors whitespace-nowrap"
      style={{
        borderColor:     active ? "var(--signal)" : "transparent",
        color:           active ? "var(--text)"   : "var(--text-dim)",
        background:      active ? "rgba(0,255,100,0.04)" : "transparent",
      }}
    >
      {label}
    </Link>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 shrink-0">
      <div className="w-px h-3" style={{ background: "var(--line-strong)" }} />
      <span
        className="font-mono text-[8px] uppercase tracking-[0.12em]"
        style={{ color: "var(--text-dim)", opacity: 0.45 }}
      >
        {label}
      </span>
    </div>
  );
}
