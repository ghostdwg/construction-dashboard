// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/entities/chips.tsx
//  Phase MI-4 — Shared status / confidence / pass chip components.
//
//  Visual contract: every chip is a small pill — uppercase mono lettering,
//  thin border, optional fill. Color encodes review status / confidence /
//  pass tier so a glance answers "is this trusted?".
//
//  These are server components — no client state.
// ──────────────────────────────────────────────────────────────────────────────

type ChipStyle = { color: string; bg: string; border: string };

const REVIEW_STATUS_STYLES: Record<string, ChipStyle> = {
  VERIFIED:       { color: "var(--signal-soft)", bg: "var(--signal-dim)",   border: "rgba(0,255,100,0.22)" },
  AUTO_MATCHED:   { color: "#b8ceff",            bg: "rgba(126,167,255,0.08)", border: "rgba(126,167,255,0.2)" },
  AUTO:           { color: "var(--text-soft)",   bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)" },
  PENDING_REVIEW: { color: "#ffcc72",            bg: "var(--amber-dim)",    border: "rgba(245,166,35,0.2)" },
  LOW_CONFIDENCE: { color: "#ff8b66",            bg: "rgba(255,139,102,0.06)", border: "rgba(255,139,102,0.22)" },
  REJECTED:       { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.08)" },
};

const CONFIDENCE_STYLES: Record<string, ChipStyle> = {
  VERIFIED: { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.22)" },
  HIGH:     { color: "var(--signal-soft)", bg: "var(--signal-dim)",       border: "rgba(0,255,100,0.18)" },
  MEDIUM:   { color: "#b8ceff",            bg: "rgba(126,167,255,0.08)",  border: "rgba(126,167,255,0.2)" },
  LOW:      { color: "#ffcc72",            bg: "var(--amber-dim)",        border: "rgba(245,166,35,0.2)" },
  NONE:     { color: "var(--text-dim)",    bg: "rgba(255,255,255,0.02)",  border: "rgba(255,255,255,0.07)" },
};

const PASS_LABELS: Record<string, string> = {
  pass1_exactName:   "Pass 1 · exact name",
  pass2_exactAlias:  "Pass 2 · alias",
  pass3_fuzzyHigh:   "Pass 3 · fuzzy",
  pass4_needsReview: "Pass 4 · review",
  pass5_autoCreated: "Pass 5 · auto",
  pass6_arbitrated:  "Pass 6 · arbitrated",
};

function Chip({ label, style, title }: { label: string; style: ChipStyle; title?: string }) {
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

export function ReviewStatusChip({ status }: { status: string }) {
  const style = REVIEW_STATUS_STYLES[status] ?? REVIEW_STATUS_STYLES.AUTO;
  return <Chip label={status.replace(/_/g, " ")} style={style} />;
}

export function ConfidenceChip({
  confidence,
  similarityScore,
}: {
  confidence: string;
  similarityScore?: number | null;
}) {
  const style = CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES.NONE;
  const label =
    similarityScore != null
      ? `${confidence} · ${(similarityScore * 100).toFixed(0)}%`
      : confidence;
  return <Chip label={label} style={style} />;
}

export function EntityTypeChip({ entityType }: { entityType: string }) {
  return (
    <span
      className="px-2 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] opacity-80"
      style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
    >
      {entityType}
    </span>
  );
}

export function PassChip({ pass }: { pass: keyof typeof PASS_LABELS | string }) {
  const label = PASS_LABELS[pass] ?? pass;
  return (
    <span
      className="px-2 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.07em] opacity-70"
      style={{ border: "1px solid var(--line)" }}
    >
      {label}
    </span>
  );
}
