"use client";

import { useSession, signOut } from "next-auth/react";

export default function UserNav() {
  const { data: session, status } = useSession();

  if (status === "loading" || !session?.user) return null;

  const role = (session.user as { role?: string }).role ?? "estimator";
  const initials = (session.user.name ?? session.user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-2.5">
      <span
        className="font-mono text-[9px] uppercase tracking-[0.06em] px-2 py-1 rounded border"
        style={{
          background: "var(--signal-dim)",
          borderColor: "rgba(0,255,100,0.22)",
          color: "var(--signal-soft)",
        }}
      >
        {role}
      </span>
      <div
        className="w-[26px] h-[26px] rounded-full flex items-center justify-center font-mono text-[10px] border"
        style={{
          background: "var(--panel)",
          borderColor: "var(--line-strong)",
          color: "var(--text-soft)",
        }}
      >
        {initials}
      </div>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="font-mono text-[9px] uppercase tracking-[0.06em] transition-colors"
        style={{ color: "var(--text-dim)" }}
        onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "var(--text)")}
        onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "var(--text-dim)")}
      >
        Sign out
      </button>
    </div>
  );
}
