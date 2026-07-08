// lib/services/submittal/provenanceLabels.ts
//
// Pure, display-only provenance label mapping for SubmittalItem.source
// (WP1b). Origin only — NEVER a quality/verification/review claim. See
// prisma/schema.prisma's SubmittalItem.source comment for the full
// provenance contract: WP1a made this field trustworthy by having the
// regex seeder stamp it correctly and updateSubmittal() promote an edited
// auto row to "manual"; WP1b only surfaces it, it does not re-derive or
// re-verify it.
//
// Deliberately a pure function, not a closed Record indexed without a
// default (see SubmittalsTab.tsx's SeverityBadge for that anti-pattern —
// safe there only because `severity` is a closed TS union; `source` is a
// plain DB string column, so an unmapped runtime value is a real
// possibility, not just a type-checker hypothetical) — any unknown or
// legacy value must render a neutral label, never crash or blank.

export type ProvenanceLabel = {
  text: string;
  className: string;
};

const KNOWN_SOURCE_LABELS: Readonly<Record<string, ProvenanceLabel>> = {
  manual: {
    text: "Manual",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  },
  regex_seed: {
    text: "Regex seed",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  ai_extraction: {
    text: "AI extract",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  csi_baseline: {
    text: "CSI baseline",
    className: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  },
  ai_organized: {
    text: "AI organized",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  drawing_analysis: {
    text: "Drawing",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

// Safe fallback for any value not in the map above — an unrecognized
// string (future source type, corrupted data, etc.) must never crash or
// silently render nothing.
const UNKNOWN_SOURCE_LABEL: ProvenanceLabel = {
  text: "Unknown source",
  className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function getProvenanceLabel(source: string | null | undefined): ProvenanceLabel {
  if (!source) return UNKNOWN_SOURCE_LABEL;
  return KNOWN_SOURCE_LABELS[source] ?? UNKNOWN_SOURCE_LABEL;
}
