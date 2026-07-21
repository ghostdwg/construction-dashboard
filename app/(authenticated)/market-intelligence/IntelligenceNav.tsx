"use client";

// ──────────────────────────────────────────────────────────────────────────────
//  app/(authenticated)/market-intelligence/IntelligenceNav.tsx
//  Market Intelligence sub-navigation. Renders the intended intelligence IA
//  (INTELLIGENCE_NAV) as links, with foundational areas honestly labelled rather
//  than presented as finished products. Contains no creation/CRM affordance.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  INTELLIGENCE_NAV,
  isIntelligenceNavActive,
  type IntelligenceNavItem,
} from "./intelligenceNav";

export default function IntelligenceNav() {
  const pathname = usePathname() ?? "/market-intelligence";

  return (
    <nav
      aria-label="Market Intelligence"
      className="flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-[var(--line)]"
      style={{ background: "rgba(255,255,255,0.015)" }}
    >
      {INTELLIGENCE_NAV.map((item) => (
        <NavChip
          key={item.key}
          item={item}
          active={isIntelligenceNavActive(item, pathname)}
        />
      ))}
    </nav>
  );
}

function NavChip({ item, active }: { item: IntelligenceNavItem; active: boolean }) {
  const foundational = item.status === "foundational";

  const base =
    "font-mono text-[10px] uppercase tracking-[0.06em] px-2.5 py-1.5 rounded-md whitespace-nowrap inline-flex items-center gap-1.5";
  const style: React.CSSProperties = {
    border: `1px solid ${active ? "var(--signal)" : "var(--line)"}`,
    color: active
      ? "var(--signal)"
      : foundational
        ? "var(--text-dim)"
        : "var(--text-soft)",
    background: active ? "var(--signal-dim)" : "rgba(255,255,255,0.02)",
    opacity: foundational ? 0.75 : 1,
  };

  const label = (
    <>
      {item.label}
      {foundational && (
        <span
          className="text-[8px] tracking-[0.08em] px-1 py-0.5 rounded"
          style={{ border: "1px solid var(--line)", color: "var(--text-dim)" }}
        >
          foundational
        </span>
      )}
    </>
  );

  // Foundational areas without a real destination are not links — presenting a
  // dead link would imply a finished product. They render as a labelled,
  // non-interactive chip with the honest note as its tooltip.
  if (!item.href) {
    return (
      <span className={base} style={{ ...style, cursor: "default" }} title={item.note} aria-disabled>
        {label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={base}
      style={style}
      title={item.note}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}
