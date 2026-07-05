// ──────────────────────────────────────────────────────────────────────────────
//  /market-intelligence/workspace — Phase MI-10 command center
//
//  Server component. Composes the 9 intelligence surfaces in a single view.
//  All read-only; mutations happen via the watchlist / alert / briefing
//  detail pages (Phase MI-10 PR-1 ships read-mostly UI).
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { summarizeWorkspaceSurfaces } from "@/lib/services/operatorWorkspace";
import { SurfaceCard } from "./surfaceCard";
import { NotActiveV1Banner } from "../NotActiveV1Banner";

export default async function WorkspacePage() {
  const surfaces = await summarizeWorkspaceSurfaces({ limit: 8 });

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: 0.5 }}>Workspace</h1>
          <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
            Real-time emergence surfaces composed from the intelligence stack. Every item is explainable —
            click through for evidence.
          </p>
        </div>
        <nav style={{ display: "flex", gap: 12, fontSize: 13 }}>
          <Link href="/market-intelligence/watchlists" style={{ color: "var(--signal-soft)", textDecoration: "none" }}>Watchlists</Link>
          <Link href="/market-intelligence/corridors" style={{ color: "var(--signal-soft)", textDecoration: "none" }}>Corridors</Link>
          <Link href="/market-intelligence/briefings" style={{ color: "var(--signal-soft)", textDecoration: "none" }}>Briefings</Link>
          <Link href="/market-intelligence/targets" style={{ color: "var(--signal-soft)", textDecoration: "none" }}>Targets</Link>
          <Link href="/market-intelligence/alerts" style={{ color: "var(--signal-soft)", textDecoration: "none" }}>Alerts</Link>
        </nav>
      </header>

      <NotActiveV1Banner reason="This command center and the five surfaces below (Watchlists, Corridors, Briefings, Targets, Alerts) read from the forecast/alert pipeline, which stays gated until ingestion has soaked (see runtime/runbooks/o2.2-first-live-activation.md §13). Expect empty panels in a fresh V1 deployment — this is not linked from primary navigation for that reason, but the route and data model are fully intact." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
        {surfaces.map((surface) => (
          <SurfaceCard key={surface.surfaceKind} surface={surface} />
        ))}
      </div>
    </main>
  );
}
