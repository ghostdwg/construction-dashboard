"use client";

import { useRouter, useSearchParams } from "next/navigation";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "trades", label: "Trades" },
  { key: "scope", label: "Scope" },
  { key: "subs", label: "Subs" },
  { key: "ai-review", label: "AI Review" },
  { key: "questions", label: "Questions" },
  { key: "leveling", label: "Leveling" },
  { key: "activity", label: "Activity" },
  { key: "handoff", label: "Handoff" },
  { key: "submittals", label: "Submittals" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function TabBar({ bidId }: { bidId: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = (searchParams.get("tab") ?? "overview") as TabKey;

  function go(tab: TabKey) {
    router.replace(`/bids/${bidId}?tab=${tab}`);
  }

  return (
    <div className="flex border-b border-zinc-200 mb-6 dark:border-zinc-700">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => go(t.key)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            active === t.key
              ? "border-black text-black dark:border-zinc-100 dark:text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
