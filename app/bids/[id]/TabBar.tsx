"use client";

// UI Nav Refactor v2 — Modern compact sidebar
//
// Flat list, icon + label, no subtitles. Tighter spacing, subtle hover,
// accent-bar active state. Matches Procore-style sidebar conventions.

import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Wrench,
  Users,
  ClipboardList,
  Sparkles,
  MessagesSquare,
  Scale,
  Activity,
  PackageCheck,
  FileCheck,
  CalendarDays,
  Mic,
  FileDown,
  ArrowUpFromLine,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

type TabKey =
  | "overview" | "documents" | "trades" | "scope" | "subs"
  | "ai-review" | "questions" | "leveling" | "activity" | "warranties"
  | "handoff" | "submittals" | "schedule" | "meetings" | "briefing" | "procore";

type TabDef = { key: TabKey; label: string; icon: LucideIcon };

const PURSUIT_TABS: TabDef[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "trades", label: "Trades", icon: Wrench },
  { key: "subs", label: "Subs", icon: Users },
  { key: "scope", label: "Scope", icon: ClipboardList },
  { key: "ai-review", label: "AI Review", icon: Sparkles },
  { key: "warranties", label: "Warranties", icon: ShieldCheck },
  { key: "questions", label: "Questions", icon: MessagesSquare },
  { key: "leveling", label: "Leveling", icon: Scale },
  { key: "activity", label: "Activity", icon: Activity },
];

const POST_AWARD_TABS: TabDef[] = [
  { key: "handoff", label: "Handoff", icon: PackageCheck },
  { key: "submittals", label: "Submittals", icon: FileCheck },
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "meetings", label: "Meetings", icon: Mic },
  { key: "briefing", label: "Briefing", icon: FileDown },
  { key: "procore", label: "Procore", icon: ArrowUpFromLine },
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
    <nav className="flex flex-col gap-0.5 min-w-[200px]">
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
      <div className="mt-4" />
      <SectionHeader label="Post-Award" active={isAwarded} />
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
    <p className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
      {label}
      {active && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
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
  const Icon = tab.icon;

  const base =
    "group relative w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors";
  const state = active
    ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
    : muted
      ? "text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/60"
      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60";

  return (
    <button onClick={onClick} className={`${base} ${state}`}>
      {/* Active accent bar on the left edge */}
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-emerald-500" />
      )}
      <Icon
        className={`h-4 w-4 shrink-0 ${
          active
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"
        }`}
      />
      <span className="truncate">{tab.label}</span>
    </button>
  );
}
