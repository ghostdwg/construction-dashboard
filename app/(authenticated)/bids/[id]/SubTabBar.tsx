"use client";

import Link from "next/link";
import {
  type TabKey,
  PURSUIT_KEYS,
  COORDINATION_KEYS,
  FIELD_KEYS,
  CLOSEOUT_KEYS,
  REFERENCE_KEYS,
  PURSUIT_SUBTABS,
  COORDINATION_SUBTABS,
  FIELD_SUBTABS,
  CLOSEOUT_SUBTABS,
  REFERENCE_SUBTABS,
} from "./tabConfig";

export default function SubTabBar({
  tab,
  bidId,
  workflowType = "BID",
}: {
  tab: string;
  bidId: number;
  workflowType?: string;
}) {
  const active = tab as TabKey;
  const isProject = workflowType === "PROJECT";

  let subtabs: { key: TabKey; label: string }[] | null = null;
  if (!isProject && PURSUIT_KEYS.has(active))   subtabs = PURSUIT_SUBTABS;
  else if (COORDINATION_KEYS.has(active))        subtabs = COORDINATION_SUBTABS;
  else if (FIELD_KEYS.has(active))               subtabs = FIELD_SUBTABS;
  else if (CLOSEOUT_KEYS.has(active))            subtabs = CLOSEOUT_SUBTABS;
  else if (REFERENCE_KEYS.has(active))           subtabs = REFERENCE_SUBTABS;

  if (!subtabs) return null;

  return (
    <nav className="flex items-center border-b border-zinc-200 dark:border-zinc-700 mb-6 overflow-x-auto scrollbar-none">
      {subtabs.map((t) => (
        <Link
          key={t.key}
          href={`/bids/${bidId}?tab=${t.key}`}
          className={`shrink-0 px-3.5 py-2 text-[11px] font-mono tracking-wide border-b-2 -mb-px transition-colors ${
            active === t.key
              ? "border-[var(--color-accent)] text-zinc-900 dark:text-zinc-100"
              : "border-transparent text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
