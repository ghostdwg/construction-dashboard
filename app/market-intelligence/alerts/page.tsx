// /market-intelligence/alerts — Phase MI-10 alert feed

import Link from "next/link";
import { prisma } from "@/lib/prisma";

interface PageProps {
  searchParams: Promise<{ status?: string; severity?: string }>;
}

const SEVERITY_COLOR: Record<string, string> = {
  INFO: "var(--text-dim)",
  WATCH: "#b8ceff",
  ATTENTION: "#ffcc72",
  URGENT: "#ff7a7a",
};

export default async function AlertsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const where: Record<string, unknown> = {};
  if (sp.status) where.reviewStatus = sp.status;
  else where.reviewStatus = { in: ["UNREAD", "ACKNOWLEDGED"] };
  if (sp.severity) where.severity = sp.severity;

  const [alerts, unread, attentionPlus] = await Promise.all([
    prisma.alertEvent.findMany({
      where,
      orderBy: { capturedAt: "desc" },
      take: 200,
      include: { explanations: { take: 5 } },
    }),
    prisma.alertEvent.count({ where: { reviewStatus: "UNREAD" } }),
    prisma.alertEvent.count({ where: { severity: { in: ["ATTENTION", "URGENT"] }, reviewStatus: { in: ["UNREAD", "ACKNOWLEDGED"] } } }),
  ]);

  return (
    <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Alerts</h1>
          <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13 }}>
            Fired alerts from operator-defined rules. Every alert carries structured explanations.
          </p>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 12 }}>
          <span style={{ color: "var(--text-dim)" }}>Unread: <strong style={{ color: "var(--signal-soft)" }}>{unread}</strong></span>
          <span style={{ color: "var(--text-dim)" }}>Attention+: <strong style={{ color: "#ffcc72" }}>{attentionPlus}</strong></span>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 12, marginBottom: 16, fontSize: 12, flexWrap: "wrap" }}>
        <Link href="/market-intelligence/alerts" style={{ color: "var(--text-soft)" }}>Active</Link>
        <Link href="/market-intelligence/alerts?status=UNREAD" style={{ color: "var(--text-soft)" }}>Unread</Link>
        <Link href="/market-intelligence/alerts?status=DISMISSED" style={{ color: "var(--text-dim)" }}>Dismissed</Link>
        {["INFO", "WATCH", "ATTENTION", "URGENT"].map((s) => (
          <Link key={s} href={`/market-intelligence/alerts?severity=${s}`} style={{ color: SEVERITY_COLOR[s] }}>{s}</Link>
        ))}
      </nav>

      {alerts.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No alerts match these filters.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {alerts.map((alert) => (
            <li
              key={alert.id}
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "12px 14px",
              }}
            >
              <header style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: SEVERITY_COLOR[alert.severity] ?? "var(--text-dim)" }}>{alert.severity}</span>
                <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>{alert.headline}</h3>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{new Date(alert.capturedAt).toLocaleString()}</span>
                <span style={{ fontSize: 11, color: alert.reviewStatus === "UNREAD" ? "var(--signal-soft)" : "var(--text-dim)" }}>{alert.reviewStatus}</span>
              </header>
              {alert.detail && <p style={{ margin: 0, color: "var(--text-soft)", fontSize: 13 }}>{alert.detail}</p>}
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
                {alert.subjectKind}/{alert.subjectId.slice(0, 12)}
                {alert.capturedScore != null && ` · score ${alert.capturedScore.toFixed(2)}`}
                {alert.capturedTrajectory && ` · ${alert.capturedTrajectory}`}
                {alert.projectId && (
                  <> · <Link href={`/market-intelligence/projects/${alert.projectId}`} style={{ color: "var(--signal-soft)" }}>project</Link></>
                )}
              </div>
              {alert.explanations.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: "var(--text-dim)", cursor: "pointer" }}>
                    Explanations ({alert.explanations.length})
                  </summary>
                  <ul style={{ listStyle: "none", padding: "6px 0 0 12px", margin: 0, fontSize: 11, color: "var(--text-soft)" }}>
                    {alert.explanations.map((e) => (
                      <li key={e.id} style={{ marginBottom: 2 }}>
                        <span style={{ color: "var(--text-dim)" }}>{e.factorKind}/{e.factorName}:</span> {e.rationale}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
