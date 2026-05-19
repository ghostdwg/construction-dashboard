// Phase O1.4 — Registry tests.

import { describe, expect, test } from "vitest";
import { getRunner, listRunners, registerRunner } from "../registry";

describe("registry", () => {
  test("built-in health-check runner is registered", () => {
    const def = getRunner("health-check");
    expect(def).toBeDefined();
    expect(def?.name).toBe("health-check");
    expect(def?.windowGranularity).toBe("manual");
  });

  test("listRunners includes built-ins", () => {
    const runners = listRunners();
    expect(runners.length).toBeGreaterThanOrEqual(1);
    expect(runners.some((r) => r.name === "health-check")).toBe(true);
  });

  test("registerRunner refuses duplicates", () => {
    expect(() =>
      registerRunner({
        name: "health-check",
        windowGranularity: "manual",
        leaseSeconds: 1,
        maxDurationSeconds: 1,
        retryOnFailure: false,
        body: async () => undefined,
      })
    ).toThrow(/already registered/);
  });

  test("registerRunner accepts new names + getRunner returns them", () => {
    registerRunner({
      name: "test-only-runner-" + Date.now(),
      windowGranularity: "daily",
      leaseSeconds: 60,
      maxDurationSeconds: 30,
      retryOnFailure: true,
      body: async () => ({ ran: true }),
    });
    const names = listRunners().map((r) => r.name);
    const added = names.find((n) => n.startsWith("test-only-runner-"));
    expect(added).toBeDefined();
    const def = getRunner(added!);
    expect(def?.windowGranularity).toBe("daily");
    expect(def?.retryOnFailure).toBe(true);
  });
});
