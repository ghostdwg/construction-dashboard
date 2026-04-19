"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  HardHat,
  LayoutDashboard,
  Target,
  PackageCheck,
  Building2,
  type LucideIcon,
} from "lucide-react";
import {
  type TabKey,
  PURSUIT_KEYS,
  POST_AWARD_KEYS,
  CONSTRUCTION_KEYS,
} from "./tabConfig";

export default function TabBar({
  bidId,
  bidStatus,
  workflowType = "BID",
}: {
  bidId: number;
  bidStatus?: string;
  workflowType?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = (searchParams.get("tab") ?? "overview") as TabKey;
  const isProject = workflowType === "PROJECT";
  const isPostAward = bidStatus === "awarded" || isProject;

  function go(tab: TabKey) {
    router.replace(`/bids/${bidId}?tab=${tab}`);
  }

  return (
    <nav className="flex flex-col min-w-[180px]">
      {/* ── Logo / Brand ── */}
      <Link
        href="/bids"
        className="flex items-center gap-2.5 px-2.5 py-3 mb-1 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors"
      >
        <HardHat className="h-5 w-5 text-emerald-600 shrink-0" />
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
          Construction
        </span>
      </Link>

      <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-2" />

      {/* ── Overview ── */}
      <HubItem
        icon={LayoutDashboard}
        label="Overview"
        active={active === "overview"}
        onClick={() => go("overview")}
      />

      <div className="mt-1" />

      {/* ── Pursuit hub — hidden for standalone projects ── */}
      {!isProject && (
        <HubItem
          icon={Target}
          label="Pursuit"
          active={PURSUIT_KEYS.has(active)}
          muted={isPostAward}
          dot={!isPostAward}
          onClick={() => go("documents")}
        />
      )}

      {/* ── Post-Award hub ── */}
      <HubItem
        icon={PackageCheck}
        label="Post-Award"
        active={POST_AWARD_KEYS.has(active)}
        dot={isPostAward && !CONSTRUCTION_KEYS.has(active)}
        onClick={() => go("handoff")}
      />

      {/* ── Construction hub ── */}
      <HubItem
        icon={Building2}
        label="Construction"
        active={CONSTRUCTION_KEYS.has(active)}
        onClick={() => go("warranties")}
      />
    </nav>
  );
}

function HubItem({
  icon: Icon,
  label,
  active,
  muted = false,
  dot = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  muted?: boolean;
  dot?: boolean;
  onClick: () => void;
}) {
  const base =
    "group relative w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors";
  const state = active
    ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
    : muted
      ? "text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/60"
      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60";

  return (
    <button onClick={onClick} className={`${base} ${state}`}>
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
      <span className="truncate">{label}</span>
      {dot && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
      )}
    </button>
  );
}
