"use client";

import { useRouter } from "next/navigation";
import {
  type TabKey,
  PURSUIT_KEYS,
  POST_AWARD_KEYS,
  CONSTRUCTION_KEYS,
  PURSUIT_SUBTABS,
  POST_AWARD_SUBTABS,
  CONSTRUCTION_SUBTABS,
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
  const router = useRouter();
  const active = tab as TabKey;
  const isProject = workflowType === "PROJECT";

  function go(t: TabKey) {
    router.replace(`/bids/${bidId}?tab=${t}`);
  }

  let subtabs: { key: TabKey; label: string }[] | null = null;
  if (!isProject && PURSUIT_KEYS.has(active))   subtabs = PURSUIT_SUBTABS;
  else if (POST_AWARD_KEYS.has(active))          subtabs = POST_AWARD_SUBTABS;
  else if (CONSTRUCTION_KEYS.has(active))        subtabs = CONSTRUCTION_SUBTABS;

  if (!subtabs) return null;

  return (
    <nav className="flex items-center border-b border-zinc-200 dark:border-zinc-700 mb-6 overflow-x-auto scrollbar-none">
      {subtabs.map((t) => (
        <button
          key={t.key}
          onClick={() => go(t.key)}
          className={`shrink-0 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === t.key
              ? "border-emerald-500 text-zinc-900 dark:text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
