// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/__tests__/signalSources.test.ts
//  Phase MI-6 PR2 — Source-row → SignalInput converter tests.
//  Pure functions, no Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  relationshipEdgeToSignalInput,
  marketLeadToSignalInput,
  marketSignalToSignalInput,
  type RelationshipEdgeRow,
  type MarketLeadRow,
  type MarketSignalRow,
} from "../signalSources";

describe("relationshipEdgeToSignalInput", () => {
  test("extracts entities by role from from/to", () => {
    const row: RelationshipEdgeRow = {
      id: "edge1",
      fromType: "DEVELOPER",
      fromName: "Hubbell Realty",
      fromEntityId: "h1",
      toType: "GC",
      toName: "Weitz Company",
      toEntityId: "w1",
      relationshipType: "BUILT",
      projectName: "Walnut Creek Plat 3",
      projectYear: 2024,
      location: "Des Moines, parcel 1234567890",
      source: "permit",
      createdAt: new Date("2024-06-15"),
    };
    const signal = relationshipEdgeToSignalInput(row);
    expect(signal.kind).toBe("RELATIONSHIP_EDGE");
    expect(signal.sourceId).toBe("edge1");
    expect(signal.title).toBe("Walnut Creek Plat 3");
    expect(signal.entityIds).toEqual(
      expect.arrayContaining([
        { entityId: "h1", role: "DEVELOPER" },
        { entityId: "w1", role: "GC" },
      ])
    );
    expect(signal.parcelIds).toContain("1234567890");
    expect(signal.tags).toContain("built");
  });

  test("missing entity IDs produce empty entityIds", () => {
    const row: RelationshipEdgeRow = {
      id: "edge2",
      fromType: "DEVELOPER",
      fromName: "Unknown",
      fromEntityId: null,
      toType: "GC",
      toName: "Unknown",
      toEntityId: null,
      relationshipType: "BUILT",
      projectName: null,
      projectYear: null,
      location: null,
      source: null,
      createdAt: new Date("2024-01-01"),
    };
    const signal = relationshipEdgeToSignalInput(row);
    expect(signal.entityIds).toEqual([]);
    expect(signal.parcelIds).toEqual([]);
    expect(signal.title).toBeNull();
  });

  test("projectYear becomes occurredAt mid-year", () => {
    const row: RelationshipEdgeRow = {
      id: "e",
      fromType: "OWNER",
      fromName: "X",
      fromEntityId: null,
      toType: "GC",
      toName: "Y",
      toEntityId: null,
      relationshipType: "BUILT",
      projectName: "P",
      projectYear: 2023,
      location: null,
      source: null,
      createdAt: new Date("2024-12-31"),
    };
    const signal = relationshipEdgeToSignalInput(row);
    expect(signal.occurredAt.getUTCFullYear()).toBe(2023);
  });

  test("uppercase role normalization", () => {
    const row: RelationshipEdgeRow = {
      id: "e",
      fromType: "developer",
      fromName: "X",
      fromEntityId: "x1",
      toType: "ENGINEER",
      toName: "Y",
      toEntityId: "y1",
      relationshipType: "DESIGNED",
      projectName: null,
      projectYear: null,
      location: null,
      source: null,
      createdAt: new Date(),
    };
    const signal = relationshipEdgeToSignalInput(row);
    expect(signal.entityIds[0].role).toBe("DEVELOPER");
    expect(signal.entityIds[1].role).toBe("ENGINEER");
  });

  test("unrecognized role normalizes to OTHER", () => {
    const row: RelationshipEdgeRow = {
      id: "e",
      fromType: "MYSTERY_ROLE",
      fromName: "X",
      fromEntityId: "x1",
      toType: "OWNER",
      toName: "Y",
      toEntityId: null,
      relationshipType: "OTHER",
      projectName: null,
      projectYear: null,
      location: null,
      source: null,
      createdAt: new Date(),
    };
    const signal = relationshipEdgeToSignalInput(row);
    expect(signal.entityIds[0].role).toBe("OTHER");
  });
});

describe("marketLeadToSignalInput", () => {
  test("extracts tags from projectType and leadType", () => {
    const row: MarketLeadRow = {
      id: "lead1",
      title: "New industrial facility",
      leadType: "PERMIT",
      source: "energov",
      status: "NEW",
      confidence: "MEDIUM",
      location: "Ankeny",
      jurisdiction: "Ankeny",
      projectType: "industrial",
      estimatedValue: 1_500_000,
      detectedAt: new Date("2024-03-01"),
    };
    const signal = marketLeadToSignalInput(row);
    expect(signal.kind).toBe("MARKET_LEAD");
    expect(signal.title).toBe("New industrial facility");
    expect(signal.jurisdiction).toBe("Ankeny");
    expect(signal.tags).toContain("industrial");
    expect(signal.tags).toContain("permit");
  });
});

describe("marketSignalToSignalInput", () => {
  test("extracts headline tags + metadata parcel", () => {
    const row: MarketSignalRow = {
      id: "sig1",
      headline: "Rezoning continued to next meeting for industrial M-1",
      signalType: "MEETING_MINUTE",
      signalSubtype: "REZONING",
      sourceDate: new Date("2024-05-01"),
      metadata: JSON.stringify({ parcelId: "9876543210", address: "1000 Main St" }),
      createdAt: new Date("2024-05-02"),
    };
    const signal = marketSignalToSignalInput(row);
    expect(signal.kind).toBe("MARKET_SIGNAL");
    expect(signal.parcelIds).toContain("9876543210");
    expect(signal.address).toBe("1000 Main St");
    expect(signal.tags).toEqual(
      expect.arrayContaining(["rezoning", "continued", "m-1", "industrial"])
    );
  });

  test("invalid metadata JSON is tolerated", () => {
    const row: MarketSignalRow = {
      id: "sig2",
      headline: "Plat review",
      signalType: "MEETING_MINUTE",
      signalSubtype: "PLAT",
      sourceDate: null,
      metadata: "not-json",
      createdAt: new Date("2024-04-01"),
    };
    const signal = marketSignalToSignalInput(row);
    expect(signal.parcelIds).toEqual([]);
    expect(signal.tags).toContain("plat");
  });

  test("falls back to leadJurisdiction when metadata has no jurisdiction", () => {
    const row: MarketSignalRow = {
      id: "sig3",
      headline: "Permit issued",
      signalType: "PERMIT",
      signalSubtype: null,
      sourceDate: new Date("2024-06-01"),
      metadata: null,
      createdAt: new Date("2024-06-02"),
      leadJurisdiction: "Des Moines",
    };
    const signal = marketSignalToSignalInput(row);
    expect(signal.jurisdiction).toBe("Des Moines");
  });

  test("createdAt is used when sourceDate is null", () => {
    const row: MarketSignalRow = {
      id: "sig4",
      headline: "Late signal",
      signalType: "PERMIT",
      signalSubtype: null,
      sourceDate: null,
      metadata: null,
      createdAt: new Date("2024-07-15"),
    };
    const signal = marketSignalToSignalInput(row);
    expect(signal.occurredAt.toISOString()).toBe("2024-07-15T00:00:00.000Z");
  });
});
