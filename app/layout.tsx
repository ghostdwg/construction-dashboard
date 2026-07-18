import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import AuthProvider from "./components/AuthProvider";
import UserNav from "./components/UserNav";
import AppSidebar from "./components/AppSidebar";
import { EnvironmentBanner, getBannerHeight } from "./components/EnvironmentBanner";
import SessionTimeoutMonitor from "./components/SessionTimeoutMonitor";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

// Header is a fixed h-[62px]; the environment banner (local/staging only,
// see EnvironmentBanner.tsx) adds variable height above it. The mobile nav
// rail and its hamburger toggle are position:fixed and need the real total
// so they anchor below the topbar instead of a hardcoded 62px that only
// happens to be correct in production (where the banner renders nothing).
const TOPBAR_HEIGHT = 62 + getBannerHeight(env.APP_ENV);

export const dynamic = "force-dynamic";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GroundworX",
  description: "Construction Intelligence Platform",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {

  // ── Sidebar data ──────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/purity
  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const [bidCount, activeJob, newSignals, globalOpenActionItems] = await Promise.all([
    prisma.bid.count(),
    prisma.backgroundJob.count({ where: { status: { in: ["queued", "running"] } } }),
    prisma.marketSignal.count({ where: { leadId: null, createdAt: { gte: oneDayAgo } } }),
    prisma.meetingActionItem.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);

  return (
    <html
      lang="en"
      className={`${barlow.variable} ${ibmPlexMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="gwx-app-body flex h-dvh min-h-full flex-col overflow-hidden"
        style={{ "--topbar-h": `${TOPBAR_HEIGHT}px` } as React.CSSProperties}
      >
        <AuthProvider>
          <ThemeProvider>

            {/* ── Session inactivity timeout (30 min, warns at 28) ───────── */}
            <SessionTimeoutMonitor />

            {/* ── Environment Banner (Phase R5) ───────────────────────── */}
            {/* Renders for local + staging tiers only; production = null. */}
            <EnvironmentBanner />

            {/* ── Topbar ──────────────────────────────────────────────── */}
            <header
              className="sticky top-0 z-50 flex items-center justify-between px-[22px] h-[62px] border-b shrink-0"
              style={{
                borderColor: "var(--line)",
                background: "rgba(8,10,13,0.88)",
                backdropFilter: "blur(16px)",
              }}
            >
              {/* Brand */}
              <div className="flex items-center gap-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className="select-none"
                    style={{ fontWeight: 900, fontSize: "20px", letterSpacing: "-0.05em", color: "var(--text)" }}
                  >
                    NEURO
                  </span>
                  <div
                    style={{
                      width: "2px", height: "22px",
                      background: "var(--signal)",
                      boxShadow: "0 0 14px rgba(45,123,255,0.35)",
                    }}
                  />
                  <span
                    className="select-none"
                    style={{ fontWeight: 900, fontSize: "20px", letterSpacing: "-0.05em", color: "rgba(255,255,255,0.18)" }}
                  >
                    GLITCH
                  </span>
                </div>
                <div
                  style={{
                    paddingLeft: "14px",
                    borderLeft: "1px solid var(--line)",
                    fontSize: "16px", fontWeight: 700,
                    letterSpacing: "-0.03em",
                    color: "rgba(255,255,255,0.78)",
                  }}
                >
                  Groundwor<span style={{ color: "var(--signal)" }}>X</span>
                </div>
              </div>

              {/* Right — user */}
              <div className="flex items-center gap-3">
                <UserNav />
              </div>
            </header>

            {/* ── Below topbar: sidebar + main ────────────────────────── */}
            <div className="gwx-app-shell flex min-h-0 flex-1 overflow-hidden">
              <AppSidebar
                counts={{ projects: bidCount, activeJobs: activeJob, newSignals, openActionItems: globalOpenActionItems }}
              />
              {/*
                No marginLeft: AppSidebar's <aside> is position:static at
                >=768px (.gwx-rail in globals.css) and already reserves its
                own flex width; on mobile it's fixed/off-canvas and isn't
                meant to push content either way. A marginLeft added here
                previously double-counted the sidebar width on desktop and
                shifted every page's content on mobile even with the
                drawer closed.
              */}
              <main className="gwx-app-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain" style={{ transition: "flex-basis 200ms ease" }}>
                {children}
              </main>
            </div>

          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
