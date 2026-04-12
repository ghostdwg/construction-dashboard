"use client";

// Auth Wall — SessionProvider wrapper for the app
//
// next-auth/react's SessionProvider must wrap client components that use
// useSession(). This is a thin "use client" wrapper so the server layout
// can render it.

import { SessionProvider } from "next-auth/react";

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
