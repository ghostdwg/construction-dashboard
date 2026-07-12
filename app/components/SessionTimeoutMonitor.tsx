"use client";

// Mounted once in the root layout. Renders nothing until 28 min of
// inactivity, then shows a warning banner before the 30 min auto sign-out
// (lib/hooks/useSessionTimeout.ts) fires.

import { useSessionTimeout } from "@/lib/hooks/useSessionTimeout";

export default function SessionTimeoutMonitor() {
  const { warning } = useSessionTimeout();
  if (!warning) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-md border px-4 py-3 text-sm shadow-lg"
      style={{
        borderColor: "rgba(245,166,35,0.35)",
        background: "rgba(20,16,8,0.96)",
        color: "#ffcc72",
      }}
    >
      <p className="font-[600]">Session expiring soon</p>
      <p className="mt-1 text-xs" style={{ color: "rgba(255,204,114,0.85)" }}>
        You&apos;ll be signed out due to inactivity in about 2 minutes. Move
        your mouse or press a key to stay signed in.
      </p>
    </div>
  );
}
