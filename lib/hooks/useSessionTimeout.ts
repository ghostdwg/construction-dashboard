"use client";

// Client-side inactivity timeout — pairs with the 30 min session.maxAge in
// lib/auth.ts so the UI signs the user out at the same moment the cookie
// would otherwise silently go stale.
//
// No-ops entirely when there is no authenticated session, so this is safe
// to mount unconditionally in the root layout (app/layout.tsx) — it does
// nothing on the public landing page or while signed out.

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll"] as const;
const WARNING_AFTER_MS = 28 * 60 * 1000; // 28 min idle — warn
const SIGN_OUT_AFTER_MS = 30 * 60 * 1000; // 30 min idle — sign out
const CHECK_INTERVAL_MS = 10_000;

export function useSessionTimeout(): { warning: boolean } {
  const { status } = useSession();
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());
  const [warning, setWarning] = useState(false);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarning((prev) => (prev ? false : prev));
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    resetActivity();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetActivity, { passive: true });
    }

    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= SIGN_OUT_AFTER_MS) {
        clearInterval(interval);
        void signOut({ redirect: false }).then(() => router.push("/"));
      } else if (idleMs >= WARNING_AFTER_MS) {
        setWarning(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, resetActivity);
      }
      clearInterval(interval);
    };
  }, [status, resetActivity, router]);

  return { warning };
}
