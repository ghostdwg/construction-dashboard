// Phase O1.2 — Correlation context propagation tests.

import { describe, expect, test } from "vitest";
import {
  currentCorrelationContext,
  withCorrelationContext,
  withCorrelationContextAsync,
  newCorrelationId,
  newReplayId,
  newRunnerId,
  newIngestionId,
} from "../correlation";

describe("empty context outside scope", () => {
  test("currentCorrelationContext returns nulls", () => {
    const ctx = currentCorrelationContext();
    expect(ctx.correlationId).toBeNull();
    expect(ctx.replayId).toBeNull();
    expect(ctx.ingestionId).toBeNull();
    expect(ctx.runnerId).toBeNull();
  });
});

describe("withCorrelationContext", () => {
  test("propagates id within scope", () => {
    const cid = newCorrelationId();
    const captured = withCorrelationContext({ correlationId: cid }, () => {
      return currentCorrelationContext();
    });
    expect(captured.correlationId).toBe(cid);
  });

  test("context isolated to scope", () => {
    const before = currentCorrelationContext();
    expect(before.correlationId).toBeNull();
    withCorrelationContext({ correlationId: newCorrelationId() }, () => {
      // Inside: id is set
      expect(currentCorrelationContext().correlationId).not.toBeNull();
    });
    // After: back to null
    const after = currentCorrelationContext();
    expect(after.correlationId).toBeNull();
  });

  test("nested context inherits parent + adds own", () => {
    const cid = newCorrelationId();
    const rid = newReplayId();
    const captured = withCorrelationContext({ correlationId: cid }, () => {
      return withCorrelationContext({ replayId: rid }, () => {
        return currentCorrelationContext();
      });
    });
    expect(captured.correlationId).toBe(cid);
    expect(captured.replayId).toBe(rid);
  });
});

describe("withCorrelationContextAsync", () => {
  test("propagates id across awaits", async () => {
    const cid = newCorrelationId();
    const captured = await withCorrelationContextAsync({ correlationId: cid }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentCorrelationContext();
    });
    expect(captured.correlationId).toBe(cid);
  });
});

describe("id formats", () => {
  test("newCorrelationId starts with crl_", () => {
    expect(newCorrelationId()).toMatch(/^crl_/);
  });

  test("newReplayId starts with rep_", () => {
    expect(newReplayId()).toMatch(/^rep_/);
  });

  test("newRunnerId starts with run_<name>_", () => {
    expect(newRunnerId("forecast-daily")).toMatch(/^run_forecast-daily_/);
  });

  test("newIngestionId starts with ing_", () => {
    expect(newIngestionId()).toMatch(/^ing_/);
  });

  test("ids are unique across calls", () => {
    const ids = new Set([newCorrelationId(), newCorrelationId(), newCorrelationId()]);
    expect(ids.size).toBe(3);
  });
});
