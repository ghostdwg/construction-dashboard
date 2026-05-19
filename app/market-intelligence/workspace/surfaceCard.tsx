// ──────────────────────────────────────────────────────────────────────────────
//  Phase MI-10 — Reusable intelligence-surface card.
//  Server-component-friendly; pure display.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { IntelligenceSurfaceResult } from "@/lib/services/operatorWorkspace";

export function SurfaceCard({ surface, emptyMessage }: { surface: IntelligenceSurfaceResult; emptyMessage?: string }) {
  return (
    <section
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 6,
        padding: "12px 14px",
        marginBottom: 12,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, letterSpacing: 0.5, color: "var(--signal-soft)" }}>
          {surface.surfaceKind.replace(/_/g, " ")}
        </h3>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {surface.items.length} items · window {surface.windowDays}d
        </span>
      </header>
      {surface.items.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: 12, margin: 0 }}>
          {emptyMessage ?? "No items in this surface."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {surface.items.map((item, idx) => (
            <li
              key={`${item.subjectKind}-${item.subjectId}-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                padding: "6px 8px",
                background: "rgba(255,255,255,0.02)",
                borderRadius: 4,
              }}
            >
              <div style={{ minWidth: 0 }}>
                {item.href ? (
                  <Link href={item.href} style={{ color: "var(--signal-soft)", fontSize: 13, textDecoration: "none" }}>
                    {item.displayLabel}
                  </Link>
                ) : (
                  <span style={{ color: "var(--text-soft)", fontSize: 13 }}>{item.displayLabel}</span>
                )}
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {item.displayContext} · {item.rationale}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-dim)" }}>
                {item.scoreLabel ?? "—"}
                {item.trajectoryState && <div>{item.trajectoryState}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
