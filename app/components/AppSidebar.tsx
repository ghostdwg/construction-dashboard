"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

type SidebarCounts = {
  projects: number;
  activeJobs: number;
  newSignals: number;
  openActionItems: number;
};

export default function AppSidebar({ counts }: { counts: SidebarCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on route change (tapping a nav link on mobile)
  useEffect(() => { setOpen(false); }, [pathname]);

  function isActive(prefix: string, exact = false) {
    if (exact) return pathname === prefix;
    return pathname.startsWith(prefix);
  }

  return (
    <>
      {/* Hamburger — mobile only, always visible when sidebar is closed */}
      <button
        className="md:hidden fixed top-[72px] left-3 z-50 flex items-center justify-center w-9 h-9 rounded-[6px] border"
        style={{
          background: "var(--color-bg-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
          fontSize: "18px",
          lineHeight: 1,
        }}
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        ☰
      </button>

      {/* Backdrop — mobile only, rendered when sidebar is open */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          // Mobile: fixed overlay; desktop: static in flex row
          "fixed md:static",
          "top-[62px] md:top-auto bottom-0 md:bottom-auto",
          "left-0",
          // Width & base layout
          "flex flex-col w-[240px] shrink-0",
          "border-r border-[var(--color-border)]",
          "py-[18px] overflow-y-auto",
          // Stacking
          "z-40 md:z-auto",
          // Slide transition on mobile only
          "transition-transform duration-200 ease-in-out md:transition-none",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
        style={{ background: "linear-gradient(180deg, var(--color-bg-surface), var(--color-bg-overlay))" }}
      >
        {/* Close button — mobile only, top-right of panel */}
        <button
          className="md:hidden self-end mr-3 mb-1 flex items-center justify-center w-7 h-7 rounded"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            fontSize: "14px",
            cursor: "pointer",
          }}
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          ✕
        </button>

        {/* ── command ───────────────────────────────────────────────────── */}
        <SectionLabel label="command" />
        <SidebarItem
          href="/"
          label="Operations"
          sub="overnight jobs + reviews"
          meta={counts.activeJobs > 0 ? String(counts.activeJobs) : "—"}
          active={isActive("/", true)}
        />
        <SidebarItem
          href="/market-intelligence"
          label="Market Intelligence"
          sub="signals + pipeline scan"
          meta={counts.newSignals > 0 ? String(counts.newSignals) : "—"}
          active={isActive("/market-intelligence")}
        />
        <SidebarItem
          href="/bids"
          label="Projects"
          sub="job setup + execution"
          meta={String(counts.projects)}
          active={isActive("/bids")}
        />
        <SidebarItem
          href="/portfolio"
          label="Portfolio"
          sub="grouped pursuits + projects"
          meta={String(counts.projects)}
          active={isActive("/portfolio")}
        />

        {/* ── execution ─────────────────────────────────────────────────── */}
        <SectionLabel label="execution" />
        <SidebarItem
          href="/tasks"
          label="Tasks"
          sub="action items + manual tasks"
          meta={counts.openActionItems > 0 ? String(counts.openActionItems) : "—"}
          active={isActive("/tasks")}
        />

        {/* ── system ────────────────────────────────────────────────────── */}
        <SectionLabel label="system" />
        <SidebarItem
          href="/settings"
          label="Settings"
          sub="providers + integrations"
          meta="ok"
          active={isActive("/settings")}
        />
      </aside>
    </>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p
      className="font-mono text-[9px] uppercase tracking-[0.11em] px-4 pt-4 pb-1.5"
      style={{ color: "var(--text-dim)" }}
    >
      {label}
    </p>
  );
}

function SidebarItem({
  href, label, sub, meta, active, dim = false,
}: {
  href: string;
  label: string;
  sub: string;
  meta: string;
  active: boolean;
  dim?: boolean;
}) {
  return (
    <Link
      href={href}
      className="relative flex items-center justify-between gap-3 mx-2 mb-1 px-3 py-[11px] rounded-[7px] border transition-colors"
      style={
        active
          ? {
              background: "var(--color-bg-elevated)",
              borderColor: "transparent",
              color: "var(--color-text-primary)",
              boxShadow: "inset 2px 0 0 var(--color-accent)",
            }
          : {
              borderColor: "transparent",
              color: dim ? "var(--text-dim)" : "var(--text-soft)",
              background: "transparent",
            }
      }
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-[600] tracking-[-0.01em] truncate">{label}</span>
        <span
          className="text-[10px] truncate"
          style={{ color: "var(--text-dim)" }}
        >
          {sub}
        </span>
      </div>
      <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--text-dim)" }}>
        {meta}
      </span>
    </Link>
  );
}
