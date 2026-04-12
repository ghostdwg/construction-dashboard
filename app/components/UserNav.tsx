"use client";

// Auth Wall — User nav component (top-right in the global nav)
//
// Shows the signed-in user's name + role badge + sign-out button.
// When AUTH_DISABLED, shows nothing (no session exists).

import { useSession, signOut } from "next-auth/react";

export default function UserNav() {
  const { data: session, status } = useSession();

  if (status === "loading" || !session?.user) return null;

  const role = (session.user as { role?: string }).role ?? "estimator";

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-600 dark:text-zinc-400">
        {session.user.name ?? session.user.email}
      </span>
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {role}
      </span>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="text-xs text-zinc-500 hover:text-zinc-800 underline dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Sign out
      </button>
    </div>
  );
}
