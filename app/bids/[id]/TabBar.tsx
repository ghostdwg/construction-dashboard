"use client";

// UI Nav Refactor — Two-level vertical sidebar
//
// Replaces the 12-tab horizontal bar with a grouped sidebar. Tabs are split
// into Pursuit (bid intake through submission) and Post-Award (handoff
// modules). The ?tab= URL scheme is unchanged.

import { useRouter, useSearchParams } from "next/navigation";

type TabKey =
  | "overview" | "documents" | "trades" | "scope" | "subs"
  | "ai-review" | "questions" | "leveling" | "activity"
  | "handoff" | "submittals" | "schedule";

type TabDef = { key: TabKey; label: string; description: string };

const PURSUIT_TABS: TabDef[] = [
  { key: "overview", label: "Overview", description: "Intake, brief, go/no-go" },
  { key: "documents", label: "Documents", description: "Specs, drawings, addendums" },
  { key: "trades", label: "Trades", description: "Trade list, tiers, procurement" },
  { key: "subs", label: "Subs", description: "Invitations, RFQ, selection" },
  { key: "scope", label: "Scope", description: "Normalization, trade assignment" },
  { key: "ai-review", label: "AI Review", description: "Gap analysis by trade" },
  { key: "questions", label: "Questions", description: "RFIs, clarifications" },
  { key: "leveling", label: "Leveling", description: "Side-by-side comparison" },
  { key: "activity", label: "Activity", description: "Outreach log, reporting" },
];

const POST_AWARD_TABS: TabDef[] = [
  { key: "handoff", label: "Handoff", description: "Packet, buyout, estimate, budget" },
  { key: "submittals", label: "Submittals", description: "Register, lifecycle, Procore CSV" },
  { key: "schedule", label: "Schedule", description: "Activities, MSP export" },
];

export default function TabBar({
  bidId,
  bidStatus,
}: {
  bidId: number;
  bidStatus?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = (searchParams.get("tab") ?? "overview") as TabKey;
  const isAwarded = bidStatus === "awarded";

  function go(tab: TabKey) {
    router.replace(`/bids/${bidId}?tab=${tab}`);
  }

  return (
    <nav className="flex flex-col gap-1 min-w-[200px]">
      {/* ── Pursuit phase ── */}
      <SectionHeader label="Pursuit" active={!isAwarded} />
      {PURSUIT_TABS.map((t) => (
        <SidebarItem
          key={t.key}
          tab={t}
          active={active === t.key}
          muted={isAwarded}
          onClick={() => go(t.key)}
        />
      ))}

      {/* ── Post-Award phase ── */}
      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <SectionHeader label="Post-Award" active={isAwarded} />
      </div>
      {POST_AWARD_TABS.map((t) => (
        <SidebarItem
          key={t.key}
          tab={t}
          active={active === t.key}
          muted={false}
          onClick={() => go(t.key)}
        />
      ))}
    </nav>
  );
}

function SectionHeader({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <p
      className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${
        active
          ? "text-zinc-900 dark:text-zinc-100"
          : "text-zinc-400 dark:text-zinc-500"
      }`}
    >
      {label}
      {active && (
        <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
      )}
    </p>
  );
}

function SidebarItem({
  tab,
  active,
  muted,
  onClick,
}: {
  tab: TabDef;
  active: boolean;
  muted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : muted
            ? "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      <span className="block text-sm font-medium leading-tight">{tab.label}</span>
      <span
        className={`block text-[11px] leading-tight mt-0.5 ${
          active
            ? "text-zinc-300 dark:text-zinc-600"
            : muted
              ? "text-zinc-300 dark:text-zinc-600"
              : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        {tab.description}
      </span>
    </button>
  );
}
