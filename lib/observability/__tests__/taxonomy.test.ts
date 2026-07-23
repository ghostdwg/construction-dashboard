// Phase O1.2 — Taxonomy tests.

import { describe, expect, test } from "vitest";
import {
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
  AUDIT_SCHEMA_VERSION,
  DB_PERSISTED_CATEGORIES,
  SEVERITY_RANK,
  shouldPersistToDb,
  severityAtLeast,
} from "../taxonomy";

describe("AUDIT_SCHEMA_VERSION", () => {
  test("starts at 1.0", () => {
    expect(AUDIT_SCHEMA_VERSION).toBe("1.0");
  });
});

describe("DB_PERSISTED_CATEGORIES", () => {
  test("contains operator-action categories", () => {
    expect(DB_PERSISTED_CATEGORIES.has("operator_override")).toBe(true);
    expect(DB_PERSISTED_CATEGORIES.has("merge_split")).toBe(true);
    expect(DB_PERSISTED_CATEGORIES.has("alert_review")).toBe(true);
    expect(DB_PERSISTED_CATEGORIES.has("review_action")).toBe(true);
  });

  test("contains lineage categories", () => {
    expect(DB_PERSISTED_CATEGORIES.has("replay_run")).toBe(true);
    expect(DB_PERSISTED_CATEGORIES.has("migration_governance")).toBe(true);
    expect(DB_PERSISTED_CATEGORIES.has("runner_cycle")).toBe(true);
  });

  test("excludes high-volume engine categories", () => {
    expect(DB_PERSISTED_CATEGORIES.has("forecast_generation")).toBe(false);
    expect(DB_PERSISTED_CATEGORIES.has("entity_resolution")).toBe(false);
    expect(DB_PERSISTED_CATEGORIES.has("parcel_resolution")).toBe(false);
  });
});

describe("shouldPersistToDb", () => {
  test("routes operator-action categories to DB", () => {
    expect(shouldPersistToDb("operator_override")).toBe(true);
    expect(shouldPersistToDb("alert_review")).toBe(true);
  });

  test("keeps engine-volume categories stdout-only", () => {
    expect(shouldPersistToDb("forecast_generation")).toBe(false);
    expect(shouldPersistToDb("ingestion_decision")).toBe(false);
  });
});

describe("severity ranking", () => {
  test("DEBUG < INFO < NOTICE < WARN < ERROR < CRITICAL", () => {
    expect(SEVERITY_RANK.DEBUG).toBeLessThan(SEVERITY_RANK.INFO);
    expect(SEVERITY_RANK.INFO).toBeLessThan(SEVERITY_RANK.NOTICE);
    expect(SEVERITY_RANK.NOTICE).toBeLessThan(SEVERITY_RANK.WARN);
    expect(SEVERITY_RANK.WARN).toBeLessThan(SEVERITY_RANK.ERROR);
    expect(SEVERITY_RANK.ERROR).toBeLessThan(SEVERITY_RANK.CRITICAL);
  });

  test("severityAtLeast respects ordering", () => {
    expect(severityAtLeast("INFO", "DEBUG")).toBe(true);
    expect(severityAtLeast("DEBUG", "INFO")).toBe(false);
    expect(severityAtLeast("CRITICAL", "CRITICAL")).toBe(true);
    expect(severityAtLeast("NOTICE", "WARN")).toBe(false);
  });
});

describe("category + severity completeness", () => {
  test("26 categories registered", () => {
    // Bumped from 21 for P2-A0's "ai_prompt_scan", from 22 for OPS1's
    // "register_action", from 23 for OPS3 Phase 1A's "consultant_report"
    // (consultant report/observation/formal-response mutations), then from
    // 24 for "pursuit_promotion" (Market Intelligence → Pursuit promotion —
    // taxonomy.ts), then 26 for Card 1A's "spec_requirement".
    expect(AUDIT_CATEGORIES.length).toBe(26);
    expect(AUDIT_CATEGORIES).toContain("register_action");
    expect(AUDIT_CATEGORIES).toContain("consultant_report");
    expect(AUDIT_CATEGORIES).toContain("pursuit_promotion");
    expect(AUDIT_CATEGORIES).toContain("spec_requirement");
  });

  test("6 severities registered", () => {
    expect(AUDIT_SEVERITIES.length).toBe(6);
  });
});
