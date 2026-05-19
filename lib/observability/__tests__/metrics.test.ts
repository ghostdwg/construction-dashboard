// Phase O1.2 — Metrics + Prometheus exposition tests.

import { beforeEach, describe, expect, test } from "vitest";
import {
  recordIngestionProcessed,
  recordIngestionDuration,
  recordForecastDuration,
  recordRunnerCycle,
  recordAlertFired,
  recordAuditEmission,
  renderPrometheus,
  resetMetrics,
} from "../metrics";

beforeEach(() => {
  resetMetrics();
});

describe("counter increments", () => {
  test("recordIngestionProcessed appears in exposition output", () => {
    recordIngestionProcessed("MARKET_SIGNAL", "create_new");
    recordIngestionProcessed("MARKET_SIGNAL", "create_new");
    recordIngestionProcessed("MARKET_LEAD", "attach_to_existing");
    const out = renderPrometheus();
    expect(out).toContain("# TYPE neuroglitch_ingestion_processed_total counter");
    expect(out).toMatch(/neuroglitch_ingestion_processed_total\{source_kind="MARKET_SIGNAL",decision="create_new"\} 2/);
    expect(out).toMatch(/neuroglitch_ingestion_processed_total\{source_kind="MARKET_LEAD",decision="attach_to_existing"\} 1/);
  });

  test("recordAuditEmission tracks category + severity", () => {
    recordAuditEmission("forecast_generation", "INFO");
    recordAuditEmission("alert_review", "NOTICE");
    const out = renderPrometheus();
    expect(out).toMatch(/neuroglitch_audit_emissions_total\{category="forecast_generation",severity="INFO"\} 1/);
    expect(out).toMatch(/neuroglitch_audit_emissions_total\{category="alert_review",severity="NOTICE"\} 1/);
  });

  test("recordRunnerCycle records ok and error separately", () => {
    recordRunnerCycle("forecast-daily", "ok");
    recordRunnerCycle("forecast-daily", "ok");
    recordRunnerCycle("forecast-daily", "error");
    const out = renderPrometheus();
    expect(out).toMatch(/neuroglitch_runner_cycles_total\{runner="forecast-daily",status="ok"\} 2/);
    expect(out).toMatch(/neuroglitch_runner_cycles_total\{runner="forecast-daily",status="error"\} 1/);
  });

  test("recordAlertFired records severity + trigger_kind", () => {
    recordAlertFired("URGENT", "CORRIDOR_IGNITION");
    const out = renderPrometheus();
    expect(out).toMatch(/neuroglitch_alerts_fired_total\{severity="URGENT",trigger_kind="CORRIDOR_IGNITION"\} 1/);
  });
});

describe("histogram observations", () => {
  test("recordIngestionDuration writes buckets + sum + count", () => {
    recordIngestionDuration("MARKET_SIGNAL", 0.05);
    recordIngestionDuration("MARKET_SIGNAL", 0.2);
    recordIngestionDuration("MARKET_SIGNAL", 1.5);
    const out = renderPrometheus();
    expect(out).toContain("# TYPE neuroglitch_ingestion_duration_seconds histogram");
    expect(out).toMatch(/neuroglitch_ingestion_duration_seconds_count\{source_kind="MARKET_SIGNAL"\} 3/);
    // sum = 1.75
    expect(out).toMatch(/neuroglitch_ingestion_duration_seconds_sum\{source_kind="MARKET_SIGNAL"\} 1\.75/);
    // bucket le="0.1" contains values ≤ 0.1 (just 0.05)
    expect(out).toMatch(/neuroglitch_ingestion_duration_seconds_bucket\{source_kind="MARKET_SIGNAL",le="0\.1"\} 1/);
    // bucket le="+Inf" contains all
    expect(out).toMatch(/neuroglitch_ingestion_duration_seconds_bucket\{source_kind="MARKET_SIGNAL",le="\+Inf"\} 3/);
  });

  test("forecast histogram supports multiple label values", () => {
    recordForecastDuration("PROJECT", 0.01);
    recordForecastDuration("PARCEL", 0.05);
    recordForecastDuration("PROJECT", 0.02);
    const out = renderPrometheus();
    expect(out).toMatch(/neuroglitch_forecast_duration_seconds_count\{subject_kind="PROJECT"\} 2/);
    expect(out).toMatch(/neuroglitch_forecast_duration_seconds_count\{subject_kind="PARCEL"\} 1/);
  });
});

describe("empty histogram output", () => {
  test("renders zero counts when no observations", () => {
    const out = renderPrometheus();
    // Replay duration histogram has no labels and starts empty
    expect(out).toMatch(/neuroglitch_replay_duration_seconds_count 0/);
    expect(out).toMatch(/neuroglitch_replay_duration_seconds_sum 0/);
  });
});

describe("Prometheus exposition format compliance", () => {
  test("every counter has a HELP and TYPE line", () => {
    recordIngestionProcessed("MARKET_SIGNAL", "ok");
    const out = renderPrometheus();
    const helpLines = out.match(/^# HELP /gm) ?? [];
    const typeLines = out.match(/^# TYPE /gm) ?? [];
    expect(helpLines.length).toBeGreaterThanOrEqual(8);
    expect(typeLines.length).toBe(helpLines.length);
  });

  test("output ends with newline", () => {
    const out = renderPrometheus();
    expect(out.endsWith("\n")).toBe(true);
  });
});
