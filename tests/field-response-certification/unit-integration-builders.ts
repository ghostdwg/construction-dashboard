// tests/field-response-certification/unit-integration-builders.ts
//
// Reusable fixture builders for Field Response certification tests.
// Produces typed in-memory rows that mirror the Prisma schema shapes
// used in Vitest mocks — no DB, no network.

// ── Schema-mirroring types ────────────────────────────────────────────────────

export interface FixtureReport {
  id: number;
  bidId: number;
  vendorName: string;
  title: string | null;
  reportNumber: string | null;
  reportNumberNormalized: string | null;
  reportType: string;
  reportDate: Date | null;
  status: string;
  uploadedBy: string | null;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FixtureObservation {
  id: number;
  reportId: number;
  bidId: number;
  observationText: string;
  sourcePage: string | null;
  consultantTargetDate: Date | null;
  state: string;
  registerItemId: number | null;
  spawnedItemId: number | null;
  dismissedReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  report?: Partial<FixtureReport>;
  registerItem?: Partial<FixtureTrackedItem> | null;
  dispositions?: FixtureDisposition[];
}

export interface FixtureTrackedItem {
  id: number;
  bidId: number;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  tradeId: number | null;
  dueDate: Date | null;
  sourceKind: string;
  sourceConsultantObservationId: number | null;
  sourceFieldReportId: number | null;
  evidenceExcerpt: string | null;
  sourceLocator: string | null;
  extractionMethod: string;
  formalResponse: string | null;
  formalResponseBy: string | null;
  formalResponseAt: Date | null;
  formalResponsePrior: string | null;
  pmReviewRequired: boolean;
  closedAt: Date | null;
  closedBy: string | null;
  waivedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FixtureDisposition {
  id: number;
  observationId: number;
  bidId: number;
  dispositionType: string;
  dispositionText: string | null;
  disposedBy: string;
  disposedAt: Date;
  createdAt: Date;
}

export interface FixtureTrade {
  id: number;
  name: string;
  costCode: string | null;
  csiCode: string | null;
  isActive: boolean;
}

export interface TradeGroup {
  trade: FixtureTrade | null;
  tradeName: string;
  items: FixtureTrackedItem[];
}

// ── Counters ──────────────────────────────────────────────────────────────────

let _nextId = 1000;
export function nextId(): number {
  return _nextId++;
}
export function resetIds(start = 1000): void {
  _nextId = start;
}

// ── Report factories ──────────────────────────────────────────────────────────

export function makeAFR(overrides: Partial<FixtureReport> = {}): FixtureReport {
  const id = nextId();
  const now = new Date("2024-10-15T09:00:00.000Z");
  return {
    id,
    bidId: 9,
    vendorName: "Meridian Architecture Partners",
    title: "Architect Field Observation Report",
    reportNumber: "AFR-2024-017",
    reportNumberNormalized: "afr-2024-017",
    reportType: "ARCHITECT_FIELD_REPORT",
    reportDate: new Date("2024-10-14T00:00:00.000Z"),
    status: "ACTIVE",
    uploadedBy: "alice@example.test",
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeEFR(overrides: Partial<FixtureReport> = {}): FixtureReport {
  const id = nextId();
  const now = new Date("2024-10-16T08:30:00.000Z");
  return {
    id,
    bidId: 9,
    vendorName: "Apex Structural Group",
    title: "Field Observation Report — Structural and MEP Systems",
    reportNumber: "EFR-2024-009",
    reportNumberNormalized: "efr-2024-009",
    reportType: "ENGINEER_FIELD_REPORT",
    reportDate: new Date("2024-10-15T00:00:00.000Z"),
    status: "ACTIVE",
    uploadedBy: "bob@example.test",
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Observation factories ─────────────────────────────────────────────────────

export function makeObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  const id = nextId();
  const now = new Date("2024-10-15T10:00:00.000Z");
  return {
    id,
    reportId: 101,
    bidId: 9,
    observationText: "Synthetic observation for certification testing",
    sourcePage: null,
    consultantTargetDate: null,
    state: "ENTERED",
    registerItemId: null,
    spawnedItemId: null,
    dismissedReason: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    dispositions: [],
    ...overrides,
  };
}

export function makeArchitecturalObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "Masonry veneer at south elevation shows incomplete mortar joints at courses 6–9.",
    sourcePage: "p.2",
    consultantTargetDate: new Date("2024-10-28T00:00:00.000Z"),
    ...overrides,
  });
}

export function makeStructuralObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "Anchor bolt at BP-3 out of tolerance per AISC M4.3 — structural engineer to evaluate remediation.",
    sourcePage: "p.2, Detail 3/S-401",
    consultantTargetDate: new Date("2024-10-22T00:00:00.000Z"),
    ...overrides,
  });
}

export function makeMechanicalObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "No fire damper installed at shear wall duct penetration — mechanical contractor responsible.",
    sourcePage: "p.5",
    consultantTargetDate: new Date("2024-10-18T00:00:00.000Z"),
    ...overrides,
  });
}

export function makeElectricalObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "Conduit sleeve at SP-14 appears undersized — 2\" installed, 3\" required per drawing E-102.",
    sourcePage: "p.6",
    consultantTargetDate: new Date("2024-10-19T00:00:00.000Z"),
    ...overrides,
  });
}

export function makeInformationalObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "Temporary hoist removal scheduled 2024-11-04. East lobby entrance closed until removed. No action required.",
    sourcePage: "p.7",
    consultantTargetDate: null,
    state: "DISMISSED",
    dismissedReason: "Informational — no action required",
    ...overrides,
  });
}

export function makeDuplicateObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "Wall blocking at accessible restroom grab bar locations — previously noted in AFR-2024-014 observation #6. Confirmation docs still outstanding.",
    sourcePage: "p.6",
    consultantTargetDate: new Date("2024-10-14T00:00:00.000Z"),
    ...overrides,
  });
}

export function makeDisputedObservation(
  overrides: Partial<FixtureObservation> = {}
): FixtureObservation {
  return makeObservation({
    observationText:
      "Storefront sealant at column line 3 incomplete — responsibility disputed between glazing and masonry contractors. GC to resolve.",
    sourcePage: "p.5",
    consultantTargetDate: new Date("2024-10-18T00:00:00.000Z"),
    ...overrides,
  });
}

// ── TrackedItem factories ─────────────────────────────────────────────────────

export function makeTrackedItem(
  overrides: Partial<FixtureTrackedItem> = {}
): FixtureTrackedItem {
  const id = nextId();
  const now = new Date("2024-10-15T11:00:00.000Z");
  return {
    id,
    bidId: 9,
    kind: "FIELD_ITEM",
    title: "Synthetic tracked item for certification testing",
    description: null,
    status: "OPEN",
    priority: "MEDIUM",
    assigneeName: null,
    assigneeEmail: null,
    tradeId: null,
    dueDate: null,
    sourceKind: "consultant_report",
    sourceConsultantObservationId: null,
    sourceFieldReportId: null,
    evidenceExcerpt: null,
    sourceLocator: null,
    extractionMethod: "manual",
    formalResponse: null,
    formalResponseBy: null,
    formalResponseAt: null,
    formalResponsePrior: null,
    pmReviewRequired: false,
    closedAt: null,
    closedBy: null,
    waivedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Trade factories ───────────────────────────────────────────────────────────

export const FIXTURE_TRADES: FixtureTrade[] = [
  { id: 1, name: "Masonry",    costCode: "04000", csiCode: "04 20 00", isActive: true },
  { id: 2, name: "Roofing",    costCode: "07000", csiCode: "07 50 00", isActive: true },
  { id: 3, name: "Drywall",    costCode: "09000", csiCode: "09 21 16", isActive: true },
  { id: 4, name: "Glazing",    costCode: "08000", csiCode: "08 44 13", isActive: true },
  { id: 5, name: "Carpentry",  costCode: "06000", csiCode: "06 10 00", isActive: true },
  { id: 6, name: "Hardware",   costCode: "08700", csiCode: "08 71 00", isActive: true },
  { id: 7, name: "Steel",      costCode: "05000", csiCode: "05 12 00", isActive: true },
  { id: 8, name: "Mechanical", costCode: "15000", csiCode: "23 00 00", isActive: true },
  { id: 9, name: "Electrical", costCode: "16000", csiCode: "26 00 00", isActive: true },
  { id: 10, name: "General Conditions", costCode: "01000", csiCode: "01 00 00", isActive: true },
];

export function tradeById(id: number): FixtureTrade | undefined {
  return FIXTURE_TRADES.find((t) => t.id === id);
}

// ── Grouping utility ──────────────────────────────────────────────────────────

/** Group TrackedItems by tradeId, preserving insertion order within each group.
 *  Items with tradeId === null land in the "unassigned" group (tradeName: "Unassigned"). */
export function groupByTrade(items: FixtureTrackedItem[]): TradeGroup[] {
  const map = new Map<number | null, TradeGroup>();

  for (const item of items) {
    const key = item.tradeId;
    if (!map.has(key)) {
      const trade = key != null ? (tradeById(key) ?? null) : null;
      map.set(key, {
        trade,
        tradeName: trade?.name ?? "Unassigned",
        items: [],
      });
    }
    map.get(key)!.items.push(item);
  }

  return [...map.values()].sort((a, b) => {
    if (a.tradeName === "Unassigned") return 1;
    if (b.tradeName === "Unassigned") return -1;
    return a.tradeName.localeCompare(b.tradeName);
  });
}

// ── Observation ordering utility ──────────────────────────────────────────────

/** Assign 1-based display numbers to observations within a report, ordered by
 *  createdAt then id (mirrors the DB insert-order guarantee). */
export function assignDisplayNumbers(
  observations: FixtureObservation[]
): Array<FixtureObservation & { displayNumber: number }> {
  const sorted = [...observations].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
  );
  return sorted.map((obs, index) => ({ ...obs, displayNumber: index + 1 }));
}

// ── Disposition factories ─────────────────────────────────────────────────────

export function makeDisposition(
  overrides: Partial<FixtureDisposition> = {}
): FixtureDisposition {
  const id = nextId();
  return {
    id,
    observationId: 0,
    bidId: 9,
    dispositionType: "APPROVE",
    dispositionText: null,
    disposedBy: "alice@example.test",
    disposedAt: new Date("2024-10-25T09:00:00.000Z"),
    createdAt: new Date("2024-10-25T09:00:00.000Z"),
    ...overrides,
  };
}

// ── Revise-and-resubmit scenario builder ─────────────────────────────────────

export interface ReviseAndResubmitScenario {
  report: FixtureReport;
  observation: FixtureObservation;
  trackedItem: FixtureTrackedItem;
  initialResponse: { formalResponse: string; formalResponseBy: string };
  revisionResponse: { formalResponse: string; formalResponseBy: string; formalResponsePrior: string };
}

export function buildReviseAndResubmitScenario(): ReviseAndResubmitScenario {
  const report = makeEFR();
  const observation = makeStructuralObservation({
    reportId: report.id,
    bidId: report.bidId,
    state: "ACCEPTED_NEW_ITEM",
  });
  const trackedItem = makeTrackedItem({
    bidId: report.bidId,
    sourceConsultantObservationId: observation.id,
    title: "Anchor bolt out of tolerance — column base plate BP-3",
    evidenceExcerpt: observation.observationText.slice(0, 200),
    tradeId: 7,
    assigneeName: "Ironworks Fabricators LLC",
  });
  const initial = {
    formalResponse:
      "We propose to install a shimmed base plate per EOR revised sketch RFI-041-R1 and re-grout. Submittal to follow within 5 business days.",
    formalResponseBy: "ironworks.pm@ironworksfab.example.test",
  };
  const revision = {
    formalResponse:
      "RFI-041-R2 accepted. Base plate shimmed and regrouted per revised detail SK-S-014. Third-party inspection complete — report INSP-2024-BP3 attached. Ready for EOR acceptance.",
    formalResponseBy: "ironworks.pm@ironworksfab.example.test",
    formalResponsePrior: initial.formalResponse,
  };
  return { report, observation, trackedItem, initialResponse: initial, revisionResponse: revision };
}

// ── Accepted-closure scenario builder ────────────────────────────────────────

export interface AcceptedClosureScenario {
  report: FixtureReport;
  observation: FixtureObservation;
  trackedItem: FixtureTrackedItem;
  formalResponse: { formalResponse: string; formalResponseBy: string };
  closureDisposition: FixtureDisposition;
}

export function buildAcceptedClosureScenario(): AcceptedClosureScenario {
  const report = makeEFR();
  const observation = makeStructuralObservation({
    reportId: report.id,
    bidId: report.bidId,
    observationText:
      "Weld at HSS connection grid 3/B Level 3 appears undersized — 5/16\" leg observed, 3/8\" required. Submit UT/MT report.",
    sourcePage: "p.3, Detail 7/S-201",
    state: "ACCEPTED_NEW_ITEM",
  });
  const trackedItem = makeTrackedItem({
    bidId: report.bidId,
    sourceConsultantObservationId: observation.id,
    title: "Undersized weld — HSS connection grid 3/B Level 3",
    evidenceExcerpt: observation.observationText.slice(0, 200),
    tradeId: 7,
    assigneeName: "Ironworks Fabricators LLC",
    status: "CLOSED",
    closedAt: new Date("2024-10-25T09:00:00.000Z"),
    closedBy: "bob@example.test",
    formalResponse:
      "UT inspection by Certified Welding Inspection Services confirms weld meets 3/8\" minimum leg per AISC D1.1. Report CWIS-4421 submitted.",
    formalResponseBy: "ironworks.pm@ironworksfab.example.test",
    formalResponseAt: new Date("2024-10-24T16:00:00.000Z"),
  });
  const disposition = makeDisposition({
    observationId: observation.id,
    bidId: report.bidId,
    dispositionType: "APPROVE",
    dispositionText:
      "UT inspection confirms compliance. Accepted. Item closed.",
    disposedBy: "bob@example.test",
    disposedAt: new Date("2024-10-25T09:00:00.000Z"),
  });
  return {
    report,
    observation,
    trackedItem,
    formalResponse: {
      formalResponse: trackedItem.formalResponse!,
      formalResponseBy: trackedItem.formalResponseBy!,
    },
    closureDisposition: disposition,
  };
}
