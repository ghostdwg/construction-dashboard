// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/NotActiveV1Banner.tsx
//
//  Surface-honesty banner (feat/mi-v1-surface-honesty). This is NOT a
//  redesign — it's a one-line, additive marker for MI-10 pages whose backing
//  data pipeline is real code but is gated/deferred and not yet populated in
//  a fresh V1 deployment (see runtime/runbooks/o2.2-first-live-activation.md
//  §13 "What's NOT in PR5" and lib/services/emergenceProbability/
//  forecastGates.ts). The route, page, and underlying models are all fully
//  intact — this only clarifies operator expectations at read time.
//
//  Plain server-renderable component (no hooks) so every consumer — server
//  components across app/market-intelligence/** — can import it directly.
// ──────────────────────────────────────────────────────────────────────────────

export function NotActiveV1Banner({ reason }: { reason: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        margin: "0 0 16px",
        padding: "10px 14px",
        borderRadius: 6,
        border: "1px solid rgba(245,166,35,0.3)",
        background: "rgba(245,166,35,0.07)",
      }}
    >
      <strong
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "#ffcc72",
          whiteSpace: "nowrap",
        }}
      >
        Not active in V1
      </strong>
      <span style={{ fontSize: 12, color: "var(--text-soft)" }}>{reason}</span>
    </div>
  );
}
