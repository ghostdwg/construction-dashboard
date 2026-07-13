// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/projects/chips.tsx
//  Phase MI-6 PR3 — Shared lifecycle / probability / confidence / review-state
//  chip components for project surfaces.
//  Server components; pure visual.
// ──────────────────────────────────────────────────────────────────────────────

type ChipStyle = { color: string; bg: string; border: string };

const LIFECYCLE_STYLES: Record<string, ChipStyle> = {
  EMERGING:            { color: "var(--text-soft)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)" },
  EARLY_SIGNAL:        { color: "#b8ceff",          bg: "rgba(126,167,255,0.08)", border: "rgba(126,167,255,0.2)" },
  PRE_ENTITLEMENT:     { color: "#b8ceff",          bg: "rgba(126,167,255,0.12)", border: "rgba(126,167,255,0.28)" },
  ENTITLEMENT:         { color: "#ffcc72",          bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)" },
  SITE_PREP:           { color: "#ffcc72",          bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.28)" },
  PRE_CONSTRUCTION:    { color: "var(--signal-soft)", bg: "var(--signal-dim)",    border: "rgba(45,123,255,0.18)" },
  ACTIVE_CONSTRUCTION: { color: "var(--signal-soft)", bg: "var(--signal-dim)",    border: "rgba(45,123,255,0.32)" },
  COMPLETED:           { color: "var(--text-soft)", bg: "rgba(255,255,255,0.02)", border: "var(--line)" },
  STALLED:             { color: "#ff8b66",          bg: "rgba(255,139,102,0.06)", border: "rgba(255,139,102,0.22)" },
  ABANDONED:           { color: "var(--text-dim)",  bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.08)" },
};

const REVIEW_STYLES: Record<string, ChipStyle> = {
  AUTO_AGGREGATED: { color: "var(--text-soft)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)" },
  PENDING_REVIEW:  { color: "#ffcc72",          bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)" },
  VERIFIED:        { color: "var(--signal-soft)", bg: "var(--signal-dim)",    border: "rgba(45,123,255,0.22)" },
  REJECTED:        { color: "var(--text-dim)",  bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.08)" },
  MERGED:          { color: "var(--text-dim)",  bg: "rgba(255,255,255,0.02)", border: "rgba(126,167,255,0.2)" },
};

const CONFIDENCE_STYLES: Record<string, ChipStyle> = {
  VERIFIED: { color: "var(--signal-soft)", bg: "var(--signal-dim)",      border: "rgba(45,123,255,0.22)" },
  HIGH:     { color: "var(--signal-soft)", bg: "var(--signal-dim)",      border: "rgba(45,123,255,0.18)" },
  MEDIUM:   { color: "#b8ceff",            bg: "rgba(126,167,255,0.08)", border: "rgba(126,167,255,0.2)" },
  LOW:      { color: "#ffcc72",            bg: "var(--amber-dim)",       border: "rgba(245,166,35,0.2)" },
  NONE:     { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.07)" },
};

function pill(label: string, style: ChipStyle, title?: string) {
  return (
    <span
      title={title}
      className="px-2 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em]"
      style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}
    >
      {label}
    </span>
  );
}

export function LifecycleChip({ state }: { state: string }) {
  const s = LIFECYCLE_STYLES[state] ?? LIFECYCLE_STYLES.EMERGING;
  return pill(state.replace(/_/g, " "), s);
}

export function ReviewStatusChip({ status }: { status: string }) {
  const s = REVIEW_STYLES[status] ?? REVIEW_STYLES.AUTO_AGGREGATED;
  return pill(status.replace(/_/g, " "), s);
}

export function ConfidenceChip({ confidence }: { confidence: string }) {
  const s = CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES.NONE;
  return pill(confidence, s);
}

export function ProbabilityChip({ probability }: { probability: number | null }) {
  if (probability == null) {
    return pill("Pₑ ?", { color: "var(--text-dim)", bg: "rgba(255,255,255,0.02)", border: "var(--line)" });
  }
  const pct = (probability * 100).toFixed(0);
  let tone: ChipStyle;
  if (probability >= 0.7) {
    tone = { color: "var(--signal-soft)", bg: "var(--signal-dim)", border: "rgba(45,123,255,0.22)" };
  } else if (probability >= 0.4) {
    tone = { color: "#b8ceff", bg: "rgba(126,167,255,0.08)", border: "rgba(126,167,255,0.2)" };
  } else if (probability >= 0.2) {
    tone = { color: "#ffcc72", bg: "var(--amber-dim)", border: "rgba(245,166,35,0.2)" };
  } else {
    tone = { color: "var(--text-soft)", bg: "rgba(255,255,255,0.04)", border: "var(--line)" };
  }
  return pill(`Pₑ ${pct}%`, tone, `Emergence probability ${pct}%`);
}
