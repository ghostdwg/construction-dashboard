// ──────────────────────────────────────────────────────────────────────────────
//  .../submittals/packages/__tests__/route.test.ts
//
//  GET /api/bids/[id]/submittals/packages now additionally reports the
//  SubmittalItem → SpecSection FK (specSectionId) and the linked section's
//  file availability (sourceSectionPdfAvailability), so the UI can render a
//  "View source section" action for items that genuinely link to a spec
//  section — reusing checkFileAvailability() (Phase 3) rather than inventing
//  new availability logic. Exercises the route against a REAL LocalBlobStore
//  backed by a temp directory (not a mock), and mocks only "fs/promises" —
//  the module specifier fileAvailability.ts uses for its legacy-path
//  fs.access check, distinct from BlobStore's own "node:fs" import — so
//  BlobStore's real file I/O is never touched by that mock. Prisma is
//  mocked — no real DB.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "submittals-packages-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

const fsAccessMock = vi.fn(async (_path: string) => undefined);
vi.mock("fs/promises", () => ({
  default: { access: fsAccessMock },
  access: fsAccessMock,
}));

type ItemFixture = {
  id: number;
  bidTradeId: number | null;
  submittalNumber: string | null;
  title: string;
  type: string;
  status: string;
  requiredBy: Date | null;
  specSection: {
    id: number;
    csiNumber: string;
    csiTitle: string;
    csiCanonicalTitle: string | null;
    aiExtractions: string | null;
    pdfPath: string | null;
  } | null;
  responsibleSubId: number | null;
  responsibleSub: { id: number; company: string } | null;
  reviewer: string | null;
  notes: string | null;
  description: string | null;
  priority: string | null;
  releasePhase: string | null;
  linkedActivityId: string | null;
  leadTimeDays: number;
  reviewBufferDays: number;
  resubmitBufferDays: number;
  requiredOnSiteDate: Date | null;
  submitByDate: Date | null;
  bidTrade?: { trade: { name: string } } | null;
};

function item(overrides: Partial<ItemFixture> & { id: number; title: string }): ItemFixture {
  return {
    bidTradeId: null,
    submittalNumber: null,
    type: "PRODUCT_DATA",
    status: "PENDING",
    requiredBy: null,
    specSection: null,
    responsibleSubId: null,
    responsibleSub: null,
    reviewer: null,
    notes: null,
    description: null,
    priority: null,
    releasePhase: null,
    linkedActivityId: null,
    leadTimeDays: 0,
    reviewBufferDays: 21,
    resubmitBufferDays: 7,
    requiredOnSiteDate: null,
    submitByDate: null,
    ...overrides,
  };
}

const db = {
  packages: [] as unknown[],
  unassignedItems: [] as ItemFixture[],
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    submittalPackage: {
      findMany: vi.fn(async () => db.packages),
    },
    submittalItem: {
      findMany: vi.fn(async () => db.unassignedItems),
    },
  },
}));

const routeParams = (bidId: number) => ({ params: Promise.resolve({ id: String(bidId) }) });

describe("GET /api/bids/[id]/submittals/packages — source section linkage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsAccessMock.mockImplementation(async () => undefined);
    db.packages = [];
    db.unassignedItems = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("an item linked to a section with an available PDF reports specSectionId + durable-present availability", async () => {
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const durableKey = "plan-room/jobs/5/spec/sections/03_30_00.pdf";
    await getBlobStore().put(durableKey, Buffer.from("real bytes"));

    db.unassignedItems = [
      item({
        id: 100,
        title: "Concrete mix design",
        specSection: {
          id: 7,
          csiNumber: "03 30 00",
          csiTitle: "Cast-in-Place Concrete",
          csiCanonicalTitle: null,
          aiExtractions: null,
          pdfPath: durableKey,
        },
      }),
    ];

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(5));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.unassigned[0]).toMatchObject({
      id: 100,
      specSectionId: 7,
      sourceSectionPdfAvailability: "durable-present",
    });
  });

  test("an item with no linked section reports specSectionId: null and sourceSectionPdfAvailability: null", async () => {
    db.unassignedItems = [item({ id: 101, title: "Manual item, no spec link" })];

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(6));
    const body = await res.json();

    expect(body.unassigned[0]).toMatchObject({
      specSectionId: null,
      sourceSectionPdfAvailability: null,
    });
  });

  test("an item linked to a section whose PDF is missing reports sourceSectionPdfAvailability: missing", async () => {
    db.unassignedItems = [
      item({
        id: 102,
        title: "Rebar shop drawings",
        specSection: {
          id: 8,
          csiNumber: "03 20 00",
          csiTitle: "Concrete Reinforcing",
          csiCanonicalTitle: null,
          aiExtractions: null,
          pdfPath: "plan-room/jobs/7/spec/sections/never_uploaded.pdf",
        },
      }),
    ];

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(7));
    const body = await res.json();

    expect(body.unassigned[0]).toMatchObject({
      specSectionId: 8,
      sourceSectionPdfAvailability: "missing",
    });
  });

  test("pre-existing fields (specSectionNumber, specSectionTitle, rollup) are untouched — purely additive", async () => {
    db.unassignedItems = [
      item({
        id: 103,
        title: "Waterproofing membrane",
        specSection: {
          id: 9,
          csiNumber: "07 13 00",
          csiTitle: "Sheet Waterproofing",
          csiCanonicalTitle: "Sheet Waterproofing",
          aiExtractions: null,
          pdfPath: null,
        },
      }),
    ];

    const { GET } = await import("../route");
    const res = await GET(new Request("http://localhost/x"), routeParams(8));
    const body = await res.json();

    expect(body.unassigned[0]).toMatchObject({
      specSectionNumber: "07 13 00",
      specSectionTitle: "Sheet Waterproofing",
    });
    expect(body.rollup).toMatchObject({ total: 1 });
  });
});
