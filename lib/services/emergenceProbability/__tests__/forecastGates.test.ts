// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/__tests__/forecastGates.test.ts
//  Phase O2.2 PR7 — Forecast gating tests.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    marketSignals: 0,
    projects: 0,
    sourcesWithCadence: 0,
    failedRunnerCycles: 0,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSignal: {
      count: vi.fn(async () => store.marketSignals),
    },
    project: {
      count: vi.fn(async () => store.projects),
    },
    marketSource: {
      count: vi.fn(async () => store.sourcesWithCadence),
    },
    runnerLease: {
      count: vi.fn(async () => store.failedRunnerCycles),
    },
  },
}));

import {
  checkForecastGates,
  MIN_MARKET_SIGNALS,
  MIN_PROJECTS,
  MIN_SOURCES_WITH_CADENCE,
} from "../forecastGates";

beforeEach(() => {
  store.marketSignals = 0;
  store.projects = 0;
  store.sourcesWithCadence = 0;
  store.failedRunnerCycles = 0;
});

describe("checkForecastGates", () => {
  test("empty DB → all gates fail except no_recent_runner_errors (0 failures is fine)", async () => {
    const r = await checkForecastGates();
    expect(r.gatesPass).toBe(false);
    const names = r.results.map((g) => `${g.name}=${g.pass}`);
    expect(names).toContain("min_market_signals=false");
    expect(names).toContain("min_projects=false");
    expect(names).toContain("cadence_movement=false");
    expect(names).toContain("no_recent_runner_errors=true");
  });

  test("all thresholds met → gatesPass true", async () => {
    store.marketSignals = MIN_MARKET_SIGNALS;
    store.projects = MIN_PROJECTS;
    store.sourcesWithCadence = MIN_SOURCES_WITH_CADENCE;
    store.failedRunnerCycles = 0;
    const r = await checkForecastGates();
    expect(r.gatesPass).toBe(true);
    expect(r.results.every((g) => g.pass)).toBe(true);
  });

  test("min_market_signals: just-below threshold fails", async () => {
    store.marketSignals = MIN_MARKET_SIGNALS - 1;
    store.projects = MIN_PROJECTS;
    store.sourcesWithCadence = MIN_SOURCES_WITH_CADENCE;
    const r = await checkForecastGates();
    expect(r.gatesPass).toBe(false);
    expect(r.results.find((g) => g.name === "min_market_signals")!.pass).toBe(false);
  });

  test("no_recent_runner_errors: 1 failure → gate fails", async () => {
    store.marketSignals = MIN_MARKET_SIGNALS;
    store.projects = MIN_PROJECTS;
    store.sourcesWithCadence = MIN_SOURCES_WITH_CADENCE;
    store.failedRunnerCycles = 1;
    const r = await checkForecastGates();
    expect(r.gatesPass).toBe(false);
    expect(r.results.find((g) => g.name === "no_recent_runner_errors")!.pass).toBe(false);
  });

  test("partial threshold met → gatesPass remains false", async () => {
    store.marketSignals = 50; // half
    store.projects = MIN_PROJECTS * 2;
    store.sourcesWithCadence = MIN_SOURCES_WITH_CADENCE;
    const r = await checkForecastGates();
    expect(r.gatesPass).toBe(false);
  });

  test("structured detail strings include observed + required", async () => {
    store.marketSignals = 17;
    const r = await checkForecastGates();
    const g = r.results.find((g) => g.name === "min_market_signals")!;
    expect(g.detail).toContain("17");
    expect(g.detail).toContain(String(MIN_MARKET_SIGNALS));
  });
});
