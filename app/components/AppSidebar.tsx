"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, TrendingUp, Building2, Layers, CheckSquare, Settings2,
  Pin, X, Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PINNED_KEY = "gwx-sidebar-pinned";

type SidebarCounts = {
  projects: number;
  activeJobs: number;
  newSignals: number;
  openActionItems: number;
};

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/",                     label: "Operations",          icon: Activity,    exact: true },
  { href: "/market-intelligence",  label: "Market Intelligence", icon: TrendingUp },
  { href: "/bids",                 label: "Projects",            icon: Building2 },
  { href: "/portfolio",            label: "Portfolio",           icon: Layers },
  { href: "/tasks",                label: "Tasks",               icon: CheckSquare },
  { href: "/settings",             label: "Settings",            icon: Settings2 },
];

function getMeta(href: string, counts: SidebarCounts): string | null {
  if (href === "/")                    return counts.activeJobs > 0 ? String(counts.activeJobs) : null;
  if (href === "/market-intelligence") return counts.newSignals > 0 ? String(counts.newSignals) : null;
  if (href === "/bids")                return counts.projects > 0 ? String(counts.projects) : null;
  if (href === "/portfolio")           return counts.projects > 0 ? String(counts.projects) : null;
  if (href === "/tasks")               return counts.openActionItems > 0 ? String(counts.openActionItems) : null;
  return null;
}

export default function AppSidebar({ counts }: { counts: SidebarCounts }) {
  const pathname = usePathname();
  const [pinned,     setPinned]     = useState(false);
  const [hovered,    setHovered]    = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const expanded = pinned || hovered;
  // On mobile the overlay always shows full-width; desktop animates 64↔240
  const sidebarWidth = mobileOpen ? 240 : (expanded ? 240 : 64);

  // Restore pinned preference
  useEffect(() => {
    try { setPinned(localStorage.getItem(PINNED_KEY) === "1"); } catch {}
  }, []);

  // Close mobile panel on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Expose --sidebar-width for any CSS consumers
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${expanded ? 240 : 64}px`
    );
  }, [expanded]);

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    if (!next) setHovered(false);
    try { localStorage.setItem(PINNED_KEY, next ? "1" : "0"); } catch {}
  }

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <>
      {/* ── Mobile hamburger ─────────────────────────────────────────────── */}
      <button
        className="md:hidden fixed top-[72px] left-3 z-50 flex items-center justify-center w-9 h-9 rounded-[6px] border"
        style={{
          background: "var(--color-bg-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      {/* ── Mobile backdrop ──────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <aside
        className={`gwx-rail flex flex-col${mobileOpen ? " gwx-rail-open" : ""}`}
        style={{
          width: sidebarWidth,
          transition: "width 200ms ease",
          background: "var(--color-bg-surface)",
          borderRight: "1px solid var(--color-border)",
          overflow: "hidden",
        }}
        onMouseEnter={() => { if (!pinned) setHovered(true);  }}
        onMouseLeave={() => { if (!pinned) setHovered(false); }}
      >
        {/* Mobile close ────────────────────────────────────────────────── */}
        <div className="md:hidden flex justify-end px-3 pt-3 pb-1">
          <button
            style={{ background: "transparent", border: "none", cursor: "pointer",
                     color: "var(--color-text-dim)", padding: 4 }}
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav items ───────────────────────────────────────────────────── */}
        <nav className="flex flex-col flex-1 gap-0.5 px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href, item.exact);
            const meta   = getMeta(item.href, counts);
            const Icon   = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 0",
                  paddingLeft: active ? 5 : 8,
                  paddingRight: 8,
                  borderRadius: 7,
                  borderLeft: active
                    ? "3px solid var(--color-accent)"
                    : "3px solid transparent",
                  background: active ? "var(--color-bg-elevated)" : "transparent",
                  color: active ? "var(--color-accent)" : "var(--color-text-dim)",
                  transition: "background 0.15s, color 0.15s",
                  textDecoration: "none",
                  overflow: "hidden",
                  justifyContent: expanded || mobileOpen ? "flex-start" : "center",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = "var(--color-text-secondary)";
                    e.currentTarget.style.background = "var(--color-bg-elevated)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = "var(--color-text-dim)";
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <Icon size={18} style={{ flexShrink: 0, color: "inherit" }} />
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  opacity: (expanded || mobileOpen) ? 1 : 0,
                  transition: "opacity 150ms ease",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                }}>
                  {item.label}
                </span>
                {meta && (
                  <span style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono, monospace)",
                    color: "var(--color-text-dim)",
                    flexShrink: 0,
                    opacity: (expanded || mobileOpen) ? 1 : 0,
                    transition: "opacity 150ms ease 50ms",
                  }}>
                    {meta}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Pin toggle — desktop only, visible when expanded ───────────── */}
        <div
          className="hidden md:flex justify-end px-3 py-2 border-t"
          style={{
            borderColor: "var(--color-border)",
            opacity: expanded ? 1 : 0,
            transition: "opacity 150ms ease",
            pointerEvents: expanded ? "auto" : "none",
          }}
        >
          <button
            onClick={togglePin}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: pinned ? "var(--color-accent)" : "var(--color-text-dim)",
              padding: "4px 6px",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "var(--font-mono, monospace)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "color 0.15s",
            }}
            title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
          >
            <Pin size={12} />
            <span>{pinned ? "pinned" : "pin"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
