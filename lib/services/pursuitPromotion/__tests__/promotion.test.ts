// ──────────────────────────────────────────────────────────────────────────────
//  Promotion service tests — the real service against an in-memory Prisma fake
//  whose $transaction genuinely rolls back and whose timeline PK is genuinely
//  unique. No source-text assertions.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildPrismaMock,
  commitExternally,
  emptyStore,
  resetStore,
  type Store,
} from "./mockDb";

const { store } = vi.hoisted(() => {
  // Inline duplicate of emptyStore()'s shape — vi.hoisted cannot import.
  return {
    store: {
      leads: new Map(),
      projects: new Map(),
      bids: new Map(),
      timeline: new Map(),
      audits: [],
      bidCounter: 0,
      beforeLeadSwap: null,
      beforeTimelineCreate: null,
      failAuditWrite: false,
    } as unknown as Store,
  };
});

// lib/auth-helpers re-exports the real ROLES constants the service authorizes
// against — stub only the next-auth leaf so those constants stay under test
// rather than being duplicated here.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("@/lib/prisma", async () => {
  const { buildPrismaMock: build } = await import("./mockDb");
  return { prisma: build(store) };
});

import {
  getPromotionHistory,
  getPursuitOrigin,
  previewPromotion,
  projectPromotionEventId,
  promoteToPursuit,
} from "../index";
import type { PromotionActor } from "../types";

// Keep the fake's identity stable across the module mock.
void buildPrismaMock;
void emptyStore;

const ESTIMATOR: PromotionActor = { id: "u_est", role: "estimator", email: "est@example.com" };
const OTHER_ESTIMATOR: PromotionActor = { id: "u_other", role: "estimator", email: "o@example.com" };
const ADMIN: PromotionActor = { id: "u_admin", role: "admin", email: "admin@example.com" };
const PM: PromotionActor = { id: "u_pm", role: "pm", email: "pm@example.com" };

function seedLead(over: Partial<Record<string, unknown>> = {}) {
  const lead = {
    id: "lead_1",
    title: "Riverside Medical Office",
    status: "QUALIFIED",
    location: "1200 Riverside Dr",
    jurisdiction: "Tulsa County",
    projectType: "medical office",
    estimatedValue: 8_400_000,
    sourceUrl: "https://city.example.gov/m.pdf",
    sourceDocId: "doc_9",
    promotedToBidId: null,
    promotedAt: null,
    aiSummary: "model-generated brief",
    rawText: "scraped minutes text",
    notes: "internal desk note",
    ...over,
  };
  store.leads.set(lead.id as string, lead as never);
  return lead;
}

function seedProject(over: Partial<Record<string, unknown>> = {}) {
  const project = {
    id: "proj_1",
    workingTitle: "Eastgate Logistics Campus",
    jurisdiction: "Broken Arrow",
    projectType: "industrial",
    estimatedValue: 22_000_000,
    estimatedSqft: 310_000,
    source: "aggregated",
    reviewStatus: "AUTO_AGGREGATED",
    lifecycleState: "PRE_ENTITLEMENT",
    ...over,
  };
  store.projects.set(project.id as string, project as never);
  return project;
}

beforeEach(() => {
  resetStore(store);
});

// ── Successful promotion ──────────────────────────────────────────────────────

describe("promoteToPursuit — lead happy path", () => {
  test("creates exactly one draft pursuit owned by the actor", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(false);
    expect(store.bids.size).toBe(1);

    const bid = store.bids.get(result.bidId)!;
    expect(bid.status).toBe("draft");
    expect(bid.workflowType).toBe("BID");
    expect(bid.createdById).toBe("u_est");
    expect(bid.projectName).toBe("Riverside Medical Office");
    expect(bid.location).toBe("1200 Riverside Dr");
    expect(bid.buildingType).toBe("medical office");
  });

  test("does not copy AI, raw or internal source text onto the pursuit", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    expect(result.ok).toBe(true);

    const serialized = JSON.stringify([...store.bids.values()]);
    expect(serialized).not.toContain("model-generated brief");
    expect(serialized).not.toContain("scraped minutes text");
    expect(serialized).not.toContain("internal desk note");
  });

  test("records provenance on the lead via the existing FK", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected success");

    const lead = store.leads.get("lead_1")!;
    expect(lead.promotedToBidId).toBe(result.bidId);
    expect(lead.promotedAt).toBeInstanceOf(Date);
    expect(lead.status).toBe("PROMOTED");
  });

  test("writes a durable audit event with ids only", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected success");

    expect(store.audits).toHaveLength(1);
    const audit = store.audits[0];
    expect(audit.category).toBe("pursuit_promotion");
    expect(audit.action).toBe("promote_to_pursuit");
    expect(audit.subjectKind).toBe("LEAD");
    expect(audit.subjectId).toBe("lead_1");
    expect(audit.actorUserId).toBe("u_est");

    const payload = JSON.parse(audit.payloadJson!);
    expect(payload.bidId).toBe(result.bidId);
    expect(payload.sourceDocId).toBe("doc_9");
    expect(payload.reused).toBe(false);
    expect(payload.provenance).toBe("MarketLead.promotedToBidId");
    // Field NAMES only — never values.
    expect(audit.payloadJson).not.toContain("Riverside");
    expect(audit.payloadJson).not.toContain("model-generated");
  });

  test("a failed audit write rolls the whole promotion back (fail-closed)", async () => {
    seedLead();
    store.failAuditWrite = true;

    await expect(promoteToPursuit(ESTIMATOR, "LEAD", "lead_1")).rejects.toThrow(
      "audit-write-failed"
    );
    expect(store.bids.size).toBe(0);
    expect(store.leads.get("lead_1")!.promotedToBidId).toBeNull();
    expect(store.leads.get("lead_1")!.status).toBe("QUALIFIED");
  });
});

describe("promoteToPursuit — project happy path", () => {
  test("creates a draft pursuit and a deterministic provenance timeline event", async () => {
    seedProject();
    const result = await promoteToPursuit(ADMIN, "PROJECT", "proj_1");
    if (!result.ok) throw new Error("expected success");

    expect(store.bids.size).toBe(1);
    const bid = store.bids.get(result.bidId)!;
    expect(bid.projectName).toBe("Eastgate Logistics Campus");
    expect(bid.location).toBe("Broken Arrow");
    expect(bid.approxSqft).toBe(310_000);

    const event = store.timeline.get(projectPromotionEventId("proj_1"))!;
    expect(event).toBeDefined();
    expect(event.eventType).toBe("PROMOTED_TO_PURSUIT");
    expect(event.sourceRefKind).toBe("BID");
    expect(event.sourceRefId).toBe(String(result.bidId));
    expect(event.actorUserId).toBe("u_admin");
  });
});

// ── Duplicate protection ──────────────────────────────────────────────────────

describe("duplicate protection", () => {
  test("a sequential retry reuses the existing pursuit (lead)", async () => {
    seedLead();
    const first = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    const second = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");

    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(second.bidId).toBe(first.bidId);
    expect(second.reused).toBe(true);
    expect(store.bids.size).toBe(1);
  });

  test("a sequential retry reuses the existing pursuit (project)", async () => {
    seedProject();
    const first = await promoteToPursuit(ADMIN, "PROJECT", "proj_1");
    const second = await promoteToPursuit(ADMIN, "PROJECT", "proj_1");

    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(second.bidId).toBe(first.bidId);
    expect(second.reused).toBe(true);
    expect(store.bids.size).toBe(1);
    expect(store.timeline.size).toBe(1);
  });

  test("the reuse path is audited too", async () => {
    seedLead();
    await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");

    expect(store.audits.map((a) => a.action)).toEqual([
      "promote_to_pursuit",
      "promote_to_pursuit_reused",
    ]);
    expect(store.audits[1].decision).toBe("REUSED_EXISTING_PURSUIT");
  });

  test("concurrent lead promotion: the CAS loser creates no orphan bid", async () => {
    seedLead();

    // Interleave a competing session that COMMITS between our read and our
    // swap — its work must survive our rollback.
    store.beforeLeadSwap = () => {
      store.beforeLeadSwap = null;
      commitExternally(store, () => {
        const winnerBidId = 9001;
        store.bids.set(winnerBidId, {
          id: winnerBidId,
          projectName: "Riverside Medical Office",
          location: null,
          buildingType: null,
          approxSqft: null,
          status: "draft",
          workflowType: "BID",
          createdById: "u_est",
        });
        const lead = store.leads.get("lead_1")!;
        lead.promotedToBidId = winnerBidId;
        lead.status = "PROMOTED";
      });
    };

    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected the loser to return the winner's bid");

    expect(result.reused).toBe(true);
    // Only the winner's bid exists — the loser's insert rolled back.
    expect(store.bids.size).toBe(1);
    expect(result.bidId).toBe(store.leads.get("lead_1")!.promotedToBidId);
  });

  test("concurrent project promotion: the PK guard leaves no orphan bid", async () => {
    seedProject();

    store.beforeTimelineCreate = () => {
      store.beforeTimelineCreate = null;
      commitExternally(store, () => {
        const winnerBidId = 9002;
        store.bids.set(winnerBidId, {
          id: winnerBidId,
          projectName: "Eastgate Logistics Campus",
          location: null,
          buildingType: null,
          approxSqft: null,
          status: "draft",
          workflowType: "BID",
          createdById: "u_admin",
        });
        store.timeline.set(projectPromotionEventId("proj_1"), {
          id: projectPromotionEventId("proj_1"),
          projectId: "proj_1",
          eventType: "PROMOTED_TO_PURSUIT",
          occurredAt: new Date(),
          summary: `Promoted to pursuit #${winnerBidId}`,
          sourceRefKind: "BID",
          sourceRefId: String(winnerBidId),
          actorUserId: "u_admin",
          actorEmail: null,
          payloadJson: null,
        });
      });
    };

    const result = await promoteToPursuit(ADMIN, "PROJECT", "proj_1");
    if (!result.ok) throw new Error("expected the loser to return the winner's bid");

    expect(result.reused).toBe(true);
    expect(store.bids.size).toBe(1);
    expect(store.timeline.size).toBe(1);
  });
});

// ── Refusals ──────────────────────────────────────────────────────────────────

describe("refusals", () => {
  test("a PM cannot open a pursuit", async () => {
    seedLead();
    const result = await promoteToPursuit(PM, "LEAD", "lead_1");
    expect(result).toMatchObject({ ok: false, error: "forbidden" });
    expect(store.bids.size).toBe(0);
  });

  test.each(["ARCHIVED", "DISMISSED"])("a %s lead is ineligible", async (status) => {
    seedLead({ status });
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    expect(result).toMatchObject({ ok: false, error: "ineligible_status", status });
    expect(store.bids.size).toBe(0);
  });

  test.each([
    ["REJECTED", "PRE_ENTITLEMENT"],
    ["MERGED", "PRE_ENTITLEMENT"],
    ["AUTO_AGGREGATED", "ABANDONED"],
    ["AUTO_AGGREGATED", "COMPLETED"],
  ])("a %s/%s project is ineligible", async (reviewStatus, lifecycleState) => {
    seedProject({ reviewStatus, lifecycleState });
    const result = await promoteToPursuit(ESTIMATOR, "PROJECT", "proj_1");
    expect(result).toMatchObject({ ok: false, error: "ineligible_status" });
    expect(store.bids.size).toBe(0);
    expect(store.timeline.size).toBe(0);
  });

  test("a missing source is not_found", async () => {
    expect(await promoteToPursuit(ESTIMATOR, "LEAD", "nope")).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(await promoteToPursuit(ESTIMATOR, "PROJECT", "nope")).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });

  test("a blank source id is rejected before any read", async () => {
    expect(await promoteToPursuit(ESTIMATOR, "LEAD", "   ")).toMatchObject({
      ok: false,
      error: "invalid_source_id",
    });
  });
});

// ── Cross-scope ───────────────────────────────────────────────────────────────

describe("cross-scope isolation", () => {
  test("a different estimator is told it is taken, without the bid id", async () => {
    seedLead();
    const first = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!first.ok) throw new Error("expected success");

    const second = await promoteToPursuit(OTHER_ESTIMATOR, "LEAD", "lead_1");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("already_promoted");
    expect(JSON.stringify(second)).not.toContain(String(first.bidId));
    expect(store.bids.size).toBe(1);
  });

  test("an admin can see the existing pursuit regardless of owner", async () => {
    seedLead();
    const first = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!first.ok) throw new Error("expected success");

    const asAdmin = await promoteToPursuit(ADMIN, "LEAD", "lead_1");
    if (!asAdmin.ok) throw new Error("admin should see the pursuit");
    expect(asAdmin.bidId).toBe(first.bidId);
    expect(asAdmin.reused).toBe(true);
  });

  test("preview hides an out-of-scope pursuit but still reports it is promoted", async () => {
    seedLead();
    await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");

    const preview = await previewPromotion(OTHER_ESTIMATOR, "LEAD", "lead_1");
    expect(preview.eligible).toBe(false);
    expect(preview.reason).toBe("already_promoted");
    expect(preview.existingBidId).toBeNull();
    expect(preview.promotedOutOfScope).toBe(true);
  });
});

// ── Preview (drives every UI state) ───────────────────────────────────────────

describe("previewPromotion", () => {
  test("eligible lead previews the exact values the service will write", async () => {
    seedLead();
    const preview = await previewPromotion(ESTIMATOR, "LEAD", "lead_1");

    expect(preview.eligible).toBe(true);
    expect(preview.reason).toBeNull();
    expect(preview.existingBidId).toBeNull();

    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected success");
    const bid = store.bids.get(result.bidId)!;

    // The confirm dialog cannot disagree with what was written.
    expect(preview.draft.projectName).toBe(bid.projectName);
    expect(preview.draft.location).toBe(bid.location);
    expect(preview.draft.buildingType).toBe(bid.buildingType);
    expect(preview.draft.approxSqft).toBe(bid.approxSqft);
  });

  test("ineligible status previews as ineligible with a reason", async () => {
    seedLead({ status: "ARCHIVED" });
    const preview = await previewPromotion(ESTIMATOR, "LEAD", "lead_1");
    expect(preview.eligible).toBe(false);
    expect(preview.reason).toBe("ineligible_status");
  });

  test("already-promoted previews with the pursuit to navigate to", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected success");

    const preview = await previewPromotion(ESTIMATOR, "LEAD", "lead_1");
    expect(preview.eligible).toBe(false);
    expect(preview.reason).toBe("already_promoted");
    expect(preview.existingBidId).toBe(result.bidId);
    expect(preview.promotedOutOfScope).toBe(false);
  });

  test("a PM previews as forbidden, so the control renders disabled", async () => {
    seedLead();
    const preview = await previewPromotion(PM, "LEAD", "lead_1");
    expect(preview.eligible).toBe(false);
    expect(preview.reason).toBe("forbidden");
  });

  test("a missing source previews as not_found", async () => {
    const preview = await previewPromotion(ESTIMATOR, "LEAD", "gone");
    expect(preview.reason).toBe("not_found");
  });

  test("public values without a Bid column are shown as staying on the source", async () => {
    seedLead();
    const preview = await previewPromotion(ESTIMATOR, "LEAD", "lead_1");
    expect(preview.notCarried.map((n) => n.field)).toContain("Estimated value");
  });
});

// ── Reverse lookup ────────────────────────────────────────────────────────────

describe("getPursuitOrigin", () => {
  test("returns null for a pursuit that was never promoted", async () => {
    expect(await getPursuitOrigin(999)).toBeNull();
  });

  test("resolves a lead-originated pursuit back to its source and actor", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected success");

    const origin = await getPursuitOrigin(result.bidId);
    expect(origin).toMatchObject({
      sourceKind: "LEAD",
      sourceId: "lead_1",
      sourceTitle: "Riverside Medical Office",
      sourceDocId: "doc_9",
      actorEmail: "est@example.com",
    });
    expect(origin!.promotedAt).toBeInstanceOf(Date);
  });

  test("resolves a project-originated pursuit through the timeline event", async () => {
    seedProject();
    const result = await promoteToPursuit(ADMIN, "PROJECT", "proj_1");
    if (!result.ok) throw new Error("expected success");

    const origin = await getPursuitOrigin(result.bidId);
    expect(origin).toMatchObject({
      sourceKind: "PROJECT",
      sourceId: "proj_1",
      sourceTitle: "Eastgate Logistics Campus",
      actorUserId: "u_admin",
    });
  });

  test("carries no confidential pursuit data back into the market wing", async () => {
    seedLead();
    const result = await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    if (!result.ok) throw new Error("expected success");

    const origin = await getPursuitOrigin(result.bidId);
    expect(Object.keys(origin!).sort()).toEqual(
      [
        "actorEmail",
        "actorUserId",
        "promotedAt",
        "sourceDocId",
        "sourceId",
        "sourceKind",
        "sourceTitle",
        "sourceUrl",
      ].sort()
    );
  });
});

describe("getPromotionHistory", () => {
  test("returns the create and reuse events in order", async () => {
    seedLead();
    await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");
    await promoteToPursuit(ESTIMATOR, "LEAD", "lead_1");

    const history = await getPromotionHistory("LEAD", "lead_1");
    expect(history.map((h) => h.action)).toEqual([
      "promote_to_pursuit",
      "promote_to_pursuit_reused",
    ]);
  });
});
