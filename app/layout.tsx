import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import AuthProvider from "./components/AuthProvider";
import UserNav from "./components/UserNav";
import AppSidebar from "./components/AppSidebar";
import { prisma } from "@/lib/prisma";

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
  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const [bidCount, activeJob, activeBid, newSignals] = await Promise.all([
    prisma.bid.count(),
    prisma.backgroundJob.count({ where: { status: { in: ["queued", "running"] } } }),
    prisma.bid.findFirst({
      where: { OR: [{ workflowType: "PROJECT" }, { status: "awarded" }] },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        projectName: true,
        location: true,
        workflowType: true,
        status: true,
      },
    }),
    prisma.marketSignal.count({ where: { leadId: null, createdAt: { gte: oneDayAgo } } }),
  ]);

  // Submittal + brief data for the active project card
  const [openSubmittals, hasBrief] = activeBid
    ? await Promise.all([
        prisma.submittalItem.count({
          where: {
            bidId: activeBid.id,
            status: { in: ["PENDING", "REQUESTED", "RECEIVED", "UNDER_REVIEW"] },
          },
        }),
        prisma.bidIntelligenceBrief.findFirst({
          where: { bidId: activeBid.id },
          select: { id: true },
        }).then(Boolean),
      ])
    : [0, false];

  const activeProject = activeBid
    ? {
        id:             activeBid.id,
        projectName:    activeBid.projectName,
        location:       activeBid.location,
        workflowType:   activeBid.workflowType,
        status:         activeBid.status,
        openSubmittals,
        hasBrief,
      }
    : null;

  return (
    <html
      lang="en"
      className={`${barlow.variable} ${ibmPlexMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ThemeProvider>

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
                      boxShadow: "0 0 14px rgba(0,255,100,0.35)",
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
            <div className="flex flex-1 min-h-0">
              <AppSidebar
                counts={{ projects: bidCount, activeJobs: activeJob, newSignals }}
                activeProject={activeProject}
              />
              <main className="flex-1 min-w-0 overflow-y-auto">
                {children}
              </main>
            </div>

          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
