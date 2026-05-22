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

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

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
}
