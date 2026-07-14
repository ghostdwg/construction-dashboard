import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import AuthProvider from "./components/AuthProvider";
import UserNav from "./components/UserNav";
import AppSidebar from "./components/AppSidebar";
import { EnvironmentBanner } from "./components/EnvironmentBanner";
import SessionTimeoutMonitor from "./components/SessionTimeoutMonitor";
import { prisma } from "@/lib/prisma";

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
      <body className="min-h-full flex flex-col">
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
            <div className="flex flex-1 min-h-0 overflow-x-hidden">
              <AppSidebar
                counts={{ projects: bidCount, activeJobs: activeJob, newSignals, openActionItems: globalOpenActionItems }}
              />
              <main className="flex-1 min-w-0 overflow-y-auto" style={{ marginLeft: "var(--sidebar-width, 64px)", transition: "margin-left 200ms ease, flex-basis 200ms ease" }}>
                {children}
              </main>
            </div>

          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
