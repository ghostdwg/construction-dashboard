import { describe, expect, test } from "vitest";
import { computeSecretDisplayStatus, secretDisplayLabel } from "../secretDisplay";

describe("computeSecretDisplayStatus / secretDisplayLabel", () => {
  test("db-sourced value -> database", () => {
    expect(computeSecretDisplayStatus(true, "db")).toBe("database");
    expect(secretDisplayLabel(computeSecretDisplayStatus(true, "db"))).toBe(
      "Configured from database"
    );
  });

  test("env-sourced value -> environment", () => {
    expect(computeSecretDisplayStatus(true, "env")).toBe("environment");
    expect(secretDisplayLabel(computeSecretDisplayStatus(true, "env"))).toBe(
      "Configured from environment"
    );
  });

  test("missing source -> not-configured regardless of hasValue", () => {
    expect(computeSecretDisplayStatus(true, "missing")).toBe("not-configured");
    expect(computeSecretDisplayStatus(false, "missing")).toBe("not-configured");
  });

  test("hasValue=false always wins, even if source claims db/env", () => {
    expect(computeSecretDisplayStatus(false, "db")).toBe("not-configured");
    expect(computeSecretDisplayStatus(false, "env")).toBe("not-configured");
  });

  test("labels never contain any placeholder-like key fragment", () => {
    for (const status of ["database", "environment", "not-configured"] as const) {
      const label = secretDisplayLabel(status);
      expect(label).not.toMatch(/sk-ant|[•]/);
    }
  });
});
