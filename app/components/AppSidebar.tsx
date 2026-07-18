"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, TrendingUp, Building2, Layers, CheckSquare, Settings2,
  Pin, X, Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PINNED_KEY = "gwx-sidebar-pinned";
const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";

function subscribeToMobileViewport(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileViewportSnapshot() {
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
}

function getServerMobileViewportSnapshot() {
  return false;
}

type SidebarCounts = {
  projects: number;
  activeJobs: number;
  newSignals: number;
  openActionItems: number;
};

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/operations",           label: "Operations",          icon: Activity,    exact: true },
  { href: "/market-intelligence",  label: "Market Intelligence", icon: TrendingUp },
  { href: "/bids",                 label: "Projects",            icon: Building2 },
  { href: "/portfolio",            label: "Portfolio",           icon: Layers },
  { href: "/tasks",                label: "Tasks",               icon: CheckSquare },
  { href: "/settings",             label: "Settings",            icon: Settings2 },
];

function getMeta(href: string, counts: SidebarCounts): string | null {
  if (href === "/operations")          return counts.activeJobs > 0 ? String(counts.activeJobs) : null;
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
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );

  // Modal behavior exists only while the rail is presented as a mobile drawer.
  // The effect below also clears the underlying state when crossing to desktop,
  // so shrinking the viewport later cannot resurrect a previously open drawer.
  const mobileDialogOpen = isMobileViewport && mobileOpen;
  const expanded = pinned || hovered;
  // On mobile the overlay always shows full-width; desktop animates 64↔240
  const sidebarWidth = mobileDialogOpen ? 240 : (expanded ? 240 : 64);

  // Restore pinned preference
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the persisted browser preference after mount
    try { setPinned(localStorage.getItem(PINNED_KEY) === "1"); } catch {}
  }, []);

  // Every completed navigation permanently closes the drawer. Link clicks
  // also close eagerly below; this pathname guard covers browser history and
  // programmatic navigation without retaining a route key that can reopen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize transient drawer state with the committed route
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isMobileViewport) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- discard modal state when CSS crosses to the desktop rail
    setMobileOpen(false);
  }, [isMobileViewport]);

  // Treat the mobile rail as a modal drawer: move focus inside on open,
  // contain keyboard focus, and let Escape close it. CSS visibility keeps the
  // off-canvas links out of the tab order while the drawer is closed.
  useEffect(() => {
    if (!mobileDialogOpen) return;

    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        requestAnimationFrame(() => openButtonRef.current?.focus());
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileDialogOpen]);

  function closeMobileDrawer({ restoreFocus = false } = {}) {
    setMobileOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => openButtonRef.current?.focus());
    }
  }

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
        ref={openButtonRef}
        className="md:hidden fixed left-3 z-50 flex items-center justify-center w-9 h-9 rounded-[6px] border"
        style={{
          top: "calc(var(--topbar-h, 62px) + 10px)",
          background: "var(--color-bg-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        aria-controls="primary-navigation"
        aria-expanded={mobileDialogOpen}
      >
        <Menu size={18} />
      </button>

      {/* ── Mobile backdrop ──────────────────────────────────────────────── */}
      {mobileDialogOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => closeMobileDrawer({ restoreFocus: true })}
          aria-hidden="true"
        />
      )}

      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`gwx-rail flex shrink-0 flex-col${mobileDialogOpen ? " gwx-rail-open" : ""}`}
        role={mobileDialogOpen ? "dialog" : undefined}
        aria-modal={mobileDialogOpen || undefined}
        aria-label="Primary navigation"
        style={{
          width: sidebarWidth,
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
            ref={closeButtonRef}
            style={{ background: "transparent", border: "none", cursor: "pointer",
                     color: "var(--color-text-dim)", padding: 4 }}
            onClick={() => closeMobileDrawer({ restoreFocus: true })}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav items ───────────────────────────────────────────────────── */}
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href, item.exact);
            const meta   = getMeta(item.href, counts);
            const Icon   = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
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
                  color: active ? "var(--color-text-primary)" : "var(--color-text-dim)",
                  transition: "background 0.15s, color 0.15s",
                  textDecoration: "none",
                  overflow: "hidden",
                  justifyContent: expanded || mobileDialogOpen ? "flex-start" : "center",
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
                  opacity: (expanded || mobileDialogOpen) ? 1 : 0,
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
                    opacity: (expanded || mobileDialogOpen) ? 1 : 0,
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
