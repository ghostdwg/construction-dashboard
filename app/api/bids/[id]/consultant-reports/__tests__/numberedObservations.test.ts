// Field Response Certification — numbered-observation ordering tests.
//
// Validates that observations within a report are assigned 1-based display
// numbers in creation order (createdAt asc, then id asc as tiebreaker).
// Uses only the fixture builders — no DB, no network.
import { describe, expect, test, beforeEach } from "vitest";
import {
  makeObservation,
  assignDisplayNumbers,
  resetIds,
} from "@/tests/field-response-certification/unit-integration-builders";

beforeEach(() => {
  resetIds(2000);
});

describe("assignDisplayNumbers", () => {
  test("single observation gets display number 1", () => {
    const obs = makeObservation({
      createdAt: new Date("2024-10-14T09:00:00.000Z"),
    });
    const numbered = assignDisplayNumbers([obs]);
    expect(numbered).toHaveLength(1);
    expect(numbered[0].displayNumber).toBe(1);
  });

  test("orders by createdAt ascending", () => {
    const obs1 = makeObservation({ createdAt: new Date("2024-10-14T09:00:00.000Z") });
    const obs2 = makeObservation({ createdAt: new Date("2024-10-14T09:05:00.000Z") });
    const obs3 = makeObservation({ createdAt: new Date("2024-10-14T09:10:00.000Z") });
    // Pass in reverse order to confirm sort is applied
    const numbered = assignDisplayNumbers([obs3, obs1, obs2]);
    expect(numbered[0].id).toBe(obs1.id);
    expect(numbered[0].displayNumber).toBe(1);
    expect(numbered[1].id).toBe(obs2.id);
    expect(numbered[1].displayNumber).toBe(2);
    expect(numbered[2].id).toBe(obs3.id);
    expect(numbered[2].displayNumber).toBe(3);
  });

  test("tiebreaker: same createdAt resolved by id ascending", () => {
    const ts = new Date("2024-10-14T09:00:00.000Z");
    const obsA = makeObservation({ createdAt: ts });
    const obsB = makeObservation({ createdAt: ts });
    // obsB has higher id because it was created after obsA in this call sequence
    const numbered = assignDisplayNumbers([obsB, obsA]);
    expect(numbered[0].id).toBeLessThan(numbered[1].id);
    expect(numbered[0].displayNumber).toBe(1);
    expect(numbered[1].displayNumber).toBe(2);
  });

  test("dismissed observation retains its position in sequence", () => {
    const obs1 = makeObservation({
      state: "ENTERED",
      createdAt: new Date("2024-10-14T09:00:00.000Z"),
    });
    const obs2 = makeObservation({
      state: "DISMISSED",
      dismissedReason: "Informational — no action required",
      createdAt: new Date("2024-10-14T09:05:00.000Z"),
    });
    const obs3 = makeObservation({
      state: "ACCEPTED_NEW_ITEM",
      createdAt: new Date("2024-10-14T09:10:00.000Z"),
    });
    const numbered = assignDisplayNumbers([obs1, obs2, obs3]);
    expect(numbered[1].state).toBe("DISMISSED");
    expect(numbered[1].displayNumber).toBe(2);
  });

  test("empty observation list returns empty array", () => {
    expect(assignDisplayNumbers([])).toEqual([]);
  });

  test("seven AFR observations numbered 1–7 in creation order", () => {
    const base = new Date("2024-10-14T09:00:00.000Z");
    const observations = Array.from({ length: 7 }, (_, i) =>
      makeObservation({ createdAt: new Date(base.getTime() + i * 60_000) })
    );
    const numbered = assignDisplayNumbers(observations);
    expect(numbered.map((o) => o.displayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("display numbers are contiguous starting at 1", () => {
    const observations = Array.from({ length: 5 }, () => makeObservation());
    const numbered = assignDisplayNumbers(observations);
    expect(numbered.map((o) => o.displayNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  test("source fields are preserved on numbered observations", () => {
    const obs = makeObservation({
      observationText: "Masonry incomplete at courses 6–9",
      sourcePage: "p.2",
      consultantTargetDate: new Date("2024-10-28T00:00:00.000Z"),
      state: "ACCEPTED_NEW_ITEM",
    });
    const [numbered] = assignDisplayNumbers([obs]);
    expect(numbered.observationText).toBe("Masonry incomplete at courses 6–9");
    expect(numbered.sourcePage).toBe("p.2");
    expect(numbered.consultantTargetDate).toEqual(
      new Date("2024-10-28T00:00:00.000Z")
    );
    expect(numbered.state).toBe("ACCEPTED_NEW_ITEM");
  });
});
