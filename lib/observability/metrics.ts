// ──────────────────────────────────────────────────────────────────────────────
//  lib/observability/metrics.ts
//  Phase O1.2 — In-process Prometheus-compatible metrics registry.
//
//  No external Prom client dependency by design. We expose a tiny counter +
//  histogram registry that emits Prometheus text-format on /metrics. This
//  avoids adding a heavyweight runtime dep (prom-client ships its own
//  process metrics, gc instrumentation, etc., which we don't need yet).
//
//  When the surface area grows, swapping in prom-client is a one-file change
//  — keep the public API stable.
//
//  Conventions:
//    - Counter names use snake_case.
//    - Labels are bounded — never include unbounded ids (correlationId,
//      subjectId, etc.) in labels. Use Loki for high-cardinality queries.
//    - Histogram buckets are seconds (Prometheus convention).
// ──────────────────────────────────────────────────────────────────────────────

import type { AuditCategory, AuditSeverity } from "./taxonomy";

type LabelValues = Record<string, string>;

interface Counter {
  name: string;
  help: string;
  labelNames: string[];
  // key = JSON.stringify(sorted label values); value = count
  values: Map<string, number>;
}

interface Histogram {
  name: string;
  help: string;
  labelNames: string[];
  buckets: number[]; // upper bounds (seconds)
  // per label-key: { bucketCounts[], sum, count }
  values: Map<string, { bucketCounts: number[]; sum: number; count: number }>;
}

// O2.2 PR4 — Gauge type. Like Counter but values are SET (latest value wins)
// rather than incremented. Used for "current population" metrics like the
// due-source backlog or the stale-source count.
interface Gauge {
  name: string;
  help: string;
  labelNames: string[];
  values: Map<string, number>;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, Gauge>();

function makeKey(labelNames: string[], labels: LabelValues): string {
  const parts: string[] = [];
  for (const name of labelNames) {
    parts.push(`${name}=${labels[name] ?? "_"}`);
  }
  return parts.join("|");
}

function registerCounter(name: string, help: string, labelNames: string[] = []): Counter {
  const existing = counters.get(name);
  if (existing) return existing;
  const counter: Counter = { name, help, labelNames, values: new Map() };
  counters.set(name, counter);
  return counter;
}

function registerGauge(name: string, help: string, labelNames: string[] = []): Gauge {
  const existing = gauges.get(name);
  if (existing) return existing;
  const gauge: Gauge = { name, help, labelNames, values: new Map() };
  gauges.set(name, gauge);
  return gauge;
}

function setGauge(gauge: Gauge, value: number, labels: LabelValues = {}): void {
  const key = makeKey(gauge.labelNames, labels);
  gauge.values.set(key, value);
}

function registerHistogram(
  name: string,
  help: string,
  buckets: number[],
  labelNames: string[] = []
): Histogram {
  const existing = histograms.get(name);
  if (existing) return existing;
  // Buckets must be sorted ascending; add +Inf implicitly.
  const sortedBuckets = [...buckets].sort((a, b) => a - b);
  const histogram: Histogram = {
    name,
    help,
    labelNames,
    buckets: sortedBuckets,
    values: new Map(),
  };
  histograms.set(name, histogram);
  return histogram;
}

function incCounter(counter: Counter, labels: LabelValues = {}, value = 1): void {
  const key = makeKey(counter.labelNames, labels);
  counter.values.set(key, (counter.values.get(key) ?? 0) + value);
}

function observeHistogram(histogram: Histogram, value: number, labels: LabelValues = {}): void {
  const key = makeKey(histogram.labelNames, labels);
  let entry = histogram.values.get(key);
  if (!entry) {
    entry = { bucketCounts: new Array(histogram.buckets.length).fill(0), sum: 0, count: 0 };
    histogram.values.set(key, entry);
  }
  entry.sum += value;
  entry.count += 1;
  for (let i = 0; i < histogram.buckets.length; i++) {
    if (value <= histogram.buckets[i]) {
      entry.bucketCounts[i] += 1;
    }
  }
}

// ── Standard buckets (seconds) ─────────────────────────────────────────────
//
// Cover the latency range we care about: 1ms → 30s.
export const STANDARD_LATENCY_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
];

// ── Defined metrics ────────────────────────────────────────────────────────

const auditEmissionsCounter = registerCounter(
  "neuroglitch_audit_emissions_total",
  "Count of audit events emitted, by category + severity.",
  ["category", "severity"]
);

const auditPersistenceFailuresCounter = registerCounter(
  "neuroglitch_audit_persistence_failures_total",
  "Count of failed AuditEvent DB writes (stdout still succeeded).",
  ["category"]
);

const ingestionProcessedCounter = registerCounter(
  "neuroglitch_ingestion_processed_total",
  "Count of live-ingestion source rows processed, by source kind + decision.",
  ["source_kind", "decision"]
);

const ingestionDurationHistogram = registerHistogram(
  "neuroglitch_ingestion_duration_seconds",
  "Time to fully process a single ingestion source row.",
  STANDARD_LATENCY_BUCKETS,
  ["source_kind"]
);

const resolverLatencyHistogram = registerHistogram(
  "neuroglitch_resolver_latency_seconds",
  "Time to resolve a single name/ref through the resolver passes.",
  STANDARD_LATENCY_BUCKETS,
  ["resolver", "pass"]
);

const forecastDurationHistogram = registerHistogram(
  "neuroglitch_forecast_duration_seconds",
  "Time to compute + persist a single ForecastSnapshot.",
  STANDARD_LATENCY_BUCKETS,
  ["subject_kind"]
);

const calibrationDurationHistogram = registerHistogram(
  "neuroglitch_calibration_duration_seconds",
  "Time to evaluate calibration for a single (forecast, outcome) pair.",
  STANDARD_LATENCY_BUCKETS,
  []
);

const replayDurationHistogram = registerHistogram(
  "neuroglitch_replay_duration_seconds",
  "Time to complete a full replay-validation run.",
  [0.5, 1, 2.5, 5, 10, 30, 60, 180, 600],
  []
);

const runnerCycleCounter = registerCounter(
  "neuroglitch_runner_cycles_total",
  "Count of completed runner cycles, by runner name + status.",
  ["runner", "status"]
);

const runnerCycleDurationHistogram = registerHistogram(
  "neuroglitch_runner_cycle_duration_seconds",
  "Time to complete a runner cycle.",
  [1, 5, 10, 30, 60, 180, 600, 1800, 3600],
  ["runner"]
);

const alertFiresCounter = registerCounter(
  "neuroglitch_alerts_fired_total",
  "Count of fired AlertEvent rows, by severity + trigger_kind.",
  ["severity", "trigger_kind"]
);

const ingestionPipelineErrorCounter = registerCounter(
  "neuroglitch_ingestion_pipeline_errors_total",
  "Count of fire-and-forget ingestion path failures (stdout-only failure mode).",
  ["label"]
);

// O2.2 PR3 — count of signals dropped by the deterministic heuristic
// classifier (signalHeuristics.ts). Suppressed signals never become
// MarketSignal rows so they don't appear in ingestion_processed; this
// counter surfaces them for hygiene observability.
const signalsSuppressedCounter = registerCounter(
  "neuroglitch_signals_suppressed_total",
  "Count of signals dropped by deterministic heuristic classifier, by classification.",
  ["classification"]
);

// O2.2 PR3 — count of signals classified at each band (persisted ones
// only — SUPPRESSED is captured separately above). Same source-of-truth
// as the heuristicsClassification column on MarketSignal.
const signalsClassifiedCounter = registerCounter(
  "neuroglitch_signals_classified_total",
  "Count of signals classified into a persisted band, by classification.",
  ["classification"]
);

// ── O2.2 PR4 — Runner observability ───────────────────────────────────────
//
// Recurring-cycle visibility for the municipal-agenda-ingestion runner (and
// future agenda-style runners). Counters tick per-source within each cycle;
// gauges hold the latest-known state of the source pool.

const runnerSourcesProcessedCounter = registerCounter(
  "neuroglitch_runner_sources_processed_total",
  "Count of sources successfully scraped by a runner cycle, by runner.",
  ["runner"]
);

const runnerScrapeFailuresCounter = registerCounter(
  "neuroglitch_runner_scrape_failures_total",
  "Count of source scrapes that threw inside a runner cycle, by runner.",
  ["runner"]
);

const runnerDueSourcesGauge = registerGauge(
  "neuroglitch_runner_due_sources",
  "Number of MarketSources reported as due at the start of the most recent runner cycle.",
  ["runner"]
);

const runnerStaleSourceCountGauge = registerGauge(
  "neuroglitch_runner_stale_source_count",
  "Number of MarketSources currently in STALE_PUBLISH or OPERATOR_REVIEW publishStatus.",
  ["publish_status"]
);

// ── O2.2 PR7 — Forecast runtime observability ─────────────────────────────
//
// Per-subject counters for the forecast-daily runner. recordForecastDuration
// already exists from O1.2 (histogram). These add the count + per-subject
// failure metric + trajectory-shift visibility.

const forecastRecomputedCounter = registerCounter(
  "neuroglitch_forecast_recomputed_total",
  "Count of subjects whose forecast was recomputed, by subject kind + decision.",
  ["subject_kind", "decision"]
);

const forecastFailuresCounter = registerCounter(
  "neuroglitch_forecast_failures_total",
  "Count of per-subject forecast failures inside a forecast-daily cycle, by subject kind.",
  ["subject_kind"]
);

const forecastTrajectoryShiftsCounter = registerCounter(
  "neuroglitch_forecast_trajectory_shifts_total",
  "Count of trajectory transitions detected during forecast recompute, by from-state and to-state.",
  ["from", "to"]
);

const forecastHighEmergenceGauge = registerGauge(
  "neuroglitch_forecast_high_emergence_count",
  "Number of subjects whose latest EmergenceScore is >= 0.70 (HIGH band).",
  ["subject_kind"]
);

const forecastOverriddenGauge = registerGauge(
  "neuroglitch_forecast_overridden_count",
  "Number of ForecastSnapshots whose reviewStatus is OVERRIDDEN.",
  []
);

// ── O2.2 PR8 — Alert evaluation runtime metrics ───────────────────────────
//
// `neuroglitch_alerts_fired_total` already exists from O1.2 — incremented
// when an alert is recorded. PR8 adds detector-level counters + cooldown
// visibility + a gauge for unread alerts.

const alertsCandidatesCounter = registerCounter(
  "neuroglitch_alerts_candidates_total",
  "Count of alert candidates produced by detectors, by trigger kind (pre-cooldown).",
  ["trigger_kind"]
);

const alertsSuppressedCounter = registerCounter(
  "neuroglitch_alerts_suppressed_total",
  "Count of alert candidates suppressed before persistence, by trigger kind + reason.",
  ["trigger_kind", "reason"]
);

const alertsPersistedCounter = registerCounter(
  "neuroglitch_alerts_persisted_total",
  "Count of AlertEvent rows persisted by the runner, by trigger kind + severity.",
  ["trigger_kind", "severity"]
);

const alertsUnreadGauge = registerGauge(
  "neuroglitch_alerts_unread_count",
  "Number of AlertEvent rows with reviewStatus=UNREAD, by severity.",
  ["severity"]
);

// ── Public emission helpers ────────────────────────────────────────────────

export function recordAuditEmission(category: AuditCategory, severity: AuditSeverity): void {
  incCounter(auditEmissionsCounter, { category, severity });
}

export function recordAuditPersistenceFailure(category: AuditCategory): void {
  incCounter(auditPersistenceFailuresCounter, { category });
}

export function recordIngestionProcessed(sourceKind: string, decision: string): void {
  incCounter(ingestionProcessedCounter, { source_kind: sourceKind, decision });
}

export function recordIngestionDuration(sourceKind: string, seconds: number): void {
  observeHistogram(ingestionDurationHistogram, seconds, { source_kind: sourceKind });
}

export function recordResolverLatency(resolver: "entity" | "parcel", pass: string, seconds: number): void {
  observeHistogram(resolverLatencyHistogram, seconds, { resolver, pass });
}

export function recordForecastDuration(subjectKind: string, seconds: number): void {
  observeHistogram(forecastDurationHistogram, seconds, { subject_kind: subjectKind });
}

export function recordCalibrationDuration(seconds: number): void {
  observeHistogram(calibrationDurationHistogram, seconds, {});
}

export function recordReplayDuration(seconds: number): void {
  observeHistogram(replayDurationHistogram, seconds, {});
}

export function recordRunnerCycle(runner: string, status: "ok" | "error" | "skipped"): void {
  incCounter(runnerCycleCounter, { runner, status });
}

export function recordRunnerCycleDuration(runner: string, seconds: number): void {
  observeHistogram(runnerCycleDurationHistogram, seconds, { runner });
}

export function recordAlertFired(severity: string, triggerKind: string): void {
  incCounter(alertFiresCounter, { severity, trigger_kind: triggerKind });
}

export function recordIngestionPipelineError(label: string): void {
  incCounter(ingestionPipelineErrorCounter, { label });
}

export function recordSignalSuppression(classification: string): void {
  incCounter(signalsSuppressedCounter, { classification });
}

export function recordSignalClassification(classification: string): void {
  incCounter(signalsClassifiedCounter, { classification });
}

// O2.2 PR4 — runner observability helpers
export function recordRunnerSourceProcessed(runner: string): void {
  incCounter(runnerSourcesProcessedCounter, { runner });
}

export function recordRunnerScrapeFailure(runner: string): void {
  incCounter(runnerScrapeFailuresCounter, { runner });
}

export function setRunnerDueSources(runner: string, count: number): void {
  setGauge(runnerDueSourcesGauge, count, { runner });
}

export function setRunnerStaleSourceCount(publishStatus: string, count: number): void {
  setGauge(runnerStaleSourceCountGauge, count, { publish_status: publishStatus });
}

// O2.2 PR7 — forecast runtime helpers
export function recordForecastRecomputed(subjectKind: string, decision: "recorded" | "skipped_unchanged" | "skipped_no_data"): void {
  incCounter(forecastRecomputedCounter, { subject_kind: subjectKind, decision });
}

export function recordForecastFailure(subjectKind: string): void {
  incCounter(forecastFailuresCounter, { subject_kind: subjectKind });
}

export function recordForecastTrajectoryShift(from: string, to: string): void {
  incCounter(forecastTrajectoryShiftsCounter, { from, to });
}

export function setForecastHighEmergenceCount(subjectKind: string, count: number): void {
  setGauge(forecastHighEmergenceGauge, count, { subject_kind: subjectKind });
}

export function setForecastOverriddenCount(count: number): void {
  setGauge(forecastOverriddenGauge, count, {});
}

// O2.2 PR8 — alert runtime helpers
export function recordAlertCandidate(triggerKind: string): void {
  incCounter(alertsCandidatesCounter, { trigger_kind: triggerKind });
}

export function recordAlertSuppressed(triggerKind: string, reason: "cooldown" | "dry_run" | "detector_error"): void {
  incCounter(alertsSuppressedCounter, { trigger_kind: triggerKind, reason });
}

export function recordAlertPersisted(triggerKind: string, severity: string): void {
  incCounter(alertsPersistedCounter, { trigger_kind: triggerKind, severity });
}

export function setAlertsUnreadCount(severity: string, count: number): void {
  setGauge(alertsUnreadGauge, count, { severity });
}

// ── Renderer ───────────────────────────────────────────────────────────────
//
// Emit Prometheus exposition format. Conforms to text-format 0.0.4 — see
// https://prometheus.io/docs/instrumenting/exposition_formats/

export function renderPrometheus(): string {
  const lines: string[] = [];

  for (const counter of counters.values()) {
    lines.push(`# HELP ${counter.name} ${counter.help}`);
    lines.push(`# TYPE ${counter.name} counter`);
    if (counter.values.size === 0) {
      lines.push(`${counter.name} 0`);
    } else {
      for (const [key, count] of counter.values) {
        const labelStr = renderLabels(counter.labelNames, key);
        lines.push(`${counter.name}${labelStr} ${count}`);
      }
    }
  }

  for (const gauge of gauges.values()) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`);
    lines.push(`# TYPE ${gauge.name} gauge`);
    if (gauge.values.size === 0) {
      lines.push(`${gauge.name} 0`);
    } else {
      for (const [key, value] of gauge.values) {
        const labelStr = renderLabels(gauge.labelNames, key);
        lines.push(`${gauge.name}${labelStr} ${value}`);
      }
    }
  }

  for (const histogram of histograms.values()) {
    lines.push(`# HELP ${histogram.name} ${histogram.help}`);
    lines.push(`# TYPE ${histogram.name} histogram`);
    if (histogram.values.size === 0) {
      // Emit empty buckets so dashboards don't break on "no data".
      for (const bucket of histogram.buckets) {
        lines.push(`${histogram.name}_bucket{le="${bucket}"} 0`);
      }
      lines.push(`${histogram.name}_bucket{le="+Inf"} 0`);
      lines.push(`${histogram.name}_sum 0`);
      lines.push(`${histogram.name}_count 0`);
    } else {
      for (const [key, entry] of histogram.values) {
        const labelStr = renderLabels(histogram.labelNames, key);
        for (let i = 0; i < histogram.buckets.length; i++) {
          const labelWithBucket = labelStr.replace(/}$/, "") + (labelStr === "" ? "{" : ",") + `le="${histogram.buckets[i]}"}`;
          lines.push(`${histogram.name}_bucket${labelWithBucket} ${entry.bucketCounts[i]}`);
        }
        const labelInf = labelStr.replace(/}$/, "") + (labelStr === "" ? "{" : ",") + `le="+Inf"}`;
        lines.push(`${histogram.name}_bucket${labelInf} ${entry.count}`);
        lines.push(`${histogram.name}_sum${labelStr} ${entry.sum}`);
        lines.push(`${histogram.name}_count${labelStr} ${entry.count}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function renderLabels(labelNames: string[], key: string): string {
  if (labelNames.length === 0) return "";
  // key format: name1=val1|name2=val2|...
  const pairs = key.split("|").map((p) => {
    const eq = p.indexOf("=");
    return [p.slice(0, eq), p.slice(eq + 1)] as const;
  });
  const parts = pairs.map(([k, v]) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${parts.join(",")}}`;
}

// ── For tests ──────────────────────────────────────────────────────────────

export function resetMetrics(): void {
  for (const c of counters.values()) c.values.clear();
  for (const h of histograms.values()) h.values.clear();
  for (const g of gauges.values()) g.values.clear();
}
