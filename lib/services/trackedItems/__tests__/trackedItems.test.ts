// Module OPS1 (Slice 1) — service coverage with the repo's mocked-Prisma
// idiom. No real DB, no network, no provider imports anywhere on this path.
//
// R2 remediation: the mock now provides a rollback-capable `$transaction` and
// an `auditEvent` table so the fail-closed, in-transaction audit path is
// exercised for real — a mutation and its AuditEvent commit together or not at
// all, and a not-found/invalid request emits no `committed` audit.
import { beforeEach, describe, expect, test, vi } from "vitest";

// Suppress the post-commit stdout audit line — persistence still runs.
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

const h = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown> & { id: number; bidId: number; status: string }>,
  comments: [] as Array<Record<string, unknown> & { id: number; trackedItemId: number }>,
  attachments: [] as Array<Record<string, unknown> & { id: number; trackedItemId: number }>,
  meetingActionItems: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  audits: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("@/lib/prisma", () => {
  const p: Record<string, unknown> = {
    trackedItem: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.items.filter(
          (i) =>
            i.bidId === where.bidId &&
            (where.kind === undefined || i.kind === where.kind) &&
            (where.status === undefined || i.status === where.status) &&
            (where.assigneeName === undefined || i.assigneeName === where.assigneeName)
        )
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.items.find(
          (i) =>
            (where.id === undefined || i.id === where.id) &&
            (where.bidId === undefined || i.bidId === where.bidId) &&
            (where.sourceMeetingActionItemId === undefined ||
              i.sourceMeetingActionItemId === where.sourceMeetingActionItemId)
        );
        return found ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Emulate the DB unique guard on sourceMeetingActionItemId.
        if (
          data.sourceMeetingActionItemId != null &&
          h.items.some(
            (i) => i.sourceMeetingActionItemId === data.sourceMeetingActionItemId
          )
        ) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        const row = { id: h.nextId++, status: "OPEN", ...data } as (typeof h.items)[number];
        h.items.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.items.find((i) => i.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
    trackedItemComment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, ...data } as (typeof h.comments)[number];
        h.comments.push(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async ({ where }: { where: { trackedItemId: number } }) =>
        h.comments.filter((c) => c.trackedItemId === where.trackedItemId)
      ),
    },
    trackedItemAttachment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, ...data } as (typeof h.attachments)[number];
        h.attachments.push(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async ({ where }: { where: { trackedItemId: number } }) =>
        h.attachments.filter((a) => a.trackedItemId === where.trackedItemId)
      ),
    },
    meetingActionItem: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) =>
        h.meetingActionItems.find((m) => m.id === where.id && m.bidId === where.bidId) ?? null
      ),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push({ ...data });
        return { id: h.nextId++ };
      }),
    },
  };
  // Interactive transaction WITH rollback — atomicity tests exercise real
  // "mutation + audit commit together or not at all" behavior.
  p.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snap = {
      items: h.items.map((r) => ({ ...r })),
      comments: h.comments.map((r) => ({ ...r })),
      attachments: h.attachments.map((r) => ({ ...r })),
      meetingActionItems: h.meetingActionItems.map((r) => ({ ...r })),
      audits: h.audits.map((r) => ({ ...r })),
    };
    try {
      return await fn(p);
    } catch (err) {
      h.items.splice(0, h.items.length, ...snap.items);
      h.comments.splice(0, h.comments.length, ...snap.comments);
      h.attachments.splice(0, h.attachments.length, ...snap.attachments);
      h.meetingActionItems.splice(0, h.meetingActionItems.length, ...snap.meetingActionItems);
      h.audits.splice(0, h.audits.length, ...snap.audits);
      throw err;
    }
  };
  return { prisma: p };
});

import {
  addComment,
  createTrackedItem,
  listComments,
  listTrackedItems,
  promoteMeetingActionItem,
  recordAttachment,
  transitionTrackedItem,
  updateTrackedItem,
} from "../index";

const ACTOR = { name: "Josh", email: "josh@example.test" };

const audited = (action: string, decision?: string) =>
  h.audits.some(
    (a) =>
      a.action === action &&
      a.subjectKind === "TrackedItem" &&
      (decision === undefined || a.decision === decision)
  );

beforeEach(() => {
  h.items.length = 0;
  h.comments.length = 0;
  h.attachments.length = 0;
  h.meetingActionItems.length = 0;
  h.audits.length = 0;
  h.nextId = 1;
});

describe("trackedItems service", () => {
  test("create manual item: validates kind, stamps manual provenance explicitly, audits", async () => {
    const r = await createTrackedItem(5, { kind: "WARRANTY", title: "  2-yr roof warranty letter  " }, ACTOR);
    expect(r.ok).toBe(true);
    const row = h.items[0];
    expect(row.kind).toBe("WARRANTY");
    expect(row.title).toBe("2-yr roof warranty letter");
    expect(row.sourceKind).toBe("manual");
    expect(row.extractionMethod).toBe("manual");
    expect(row.citationVerified).toBe(false);
    // The AuditEvent row committed in the same transaction.
    expect(audited("tracked_item_create", "created")).toBe(true);

    const bad = await createTrackedItem(5, { kind: "PUNCH", title: "x" }, ACTOR);
    expect(bad.ok).toBe(false);
    const noTitle = await createTrackedItem(5, { kind: "OM", title: "   " }, ACTOR);
    expect(noTitle.ok).toBe(false);
    // Invalid requests never mutate and never emit a committed audit.
    expect(h.items.length).toBe(1);
    expect(h.audits.length).toBe(1);
  });

  test("list/filter by bid, kind, status; other bids never leak", async () => {
    await createTrackedItem(5, { kind: "WARRANTY", title: "a" }, ACTOR);
    await createTrackedItem(5, { kind: "CLOSEOUT", title: "b" }, ACTOR);
    await createTrackedItem(9, { kind: "WARRANTY", title: "other-bid" }, ACTOR);

    expect((await listTrackedItems(5)).length).toBe(2);
    expect((await listTrackedItems(5, { kind: "WARRANTY" })).length).toBe(1);
    expect((await listTrackedItems(5, { status: "OPEN" })).length).toBe(2);
    expect((await listTrackedItems(9)).map((i) => i.title)).toEqual(["other-bid"]);
    // invalid filter values are ignored, not passed to the DB
    expect((await listTrackedItems(5, { kind: "NOT_A_KIND" })).length).toBe(2);
  });

  test("FSM path via service: transition, close requires actor, waive requires reason", async () => {
    await createTrackedItem(5, { kind: "OAC_ACTION", title: "confirm paint color" }, ACTOR);
    const ok = await transitionTrackedItem(5, 1, "IN_PROGRESS", ACTOR);
    expect(ok.ok).toBe(true);
    expect(h.items[0].status).toBe("IN_PROGRESS");

    const noActor = await transitionTrackedItem(5, 1, "CLOSED", { name: "", email: "" });
    expect(noActor.ok).toBe(false);

    const waiveNoReason = await transitionTrackedItem(5, 1, "WAIVED", ACTOR);
    expect(waiveNoReason.ok).toBe(false);

    const closed = await transitionTrackedItem(5, 1, "CLOSED", ACTOR, { note: "verified on site" });
    expect(closed.ok).toBe(true);
    expect(h.items[0].status).toBe("CLOSED");
    expect(h.items[0].closedBy).toBe("josh@example.test");
    // closeout note landed as an append-only comment
    expect(h.comments.length).toBe(1);
    expect(h.comments[0].body).toBe("verified on site");
    // terminal: no further transitions
    const reopen = await transitionTrackedItem(5, 1, "OPEN", ACTOR);
    expect(reopen.ok).toBe(false);
    // audited with from->to decision
    expect(audited("tracked_item_transition", "IN_PROGRESS->CLOSED")).toBe(true);
  });

  test("comments are append-only and bid-scoped", async () => {
    await createTrackedItem(5, { kind: "TRAINING", title: "RTU training session" }, ACTOR);
    const r = await addComment(5, 1, ACTOR, "scheduled with mechanical sub");
    expect(r.ok).toBe(true);
    const wrongBid = await addComment(6, 1, ACTOR, "should not attach");
    expect(wrongBid.ok).toBe(false);
    const empty = await addComment(5, 1, ACTOR, "   ");
    expect(empty.ok).toBe(false);
    expect(await listComments(6, 1)).toBeNull();
    expect((await listComments(5, 1))!.length).toBe(1);
    expect(audited("tracked_item_comment", "comment_added")).toBe(true);
  });

  test("attachment metadata records and audits; bid-scoped", async () => {
    await createTrackedItem(5, { kind: "FIELD_ITEM", title: "cracked curb photo" }, ACTOR);
    const r = await recordAttachment(5, 1, ACTOR, {
      storageKey: "plan-room/jobs/5/tracked-items/1/tok/curb.jpg",
      fileName: "curb.jpg",
      mimeType: "image/jpeg",
      byteSize: 123456,
      kind: "photo",
    });
    expect(r.ok).toBe(true);
    expect(h.attachments[0].createdBy).toBe("josh@example.test");
    expect(await listAttachmentsSafe(6, 1)).toBeNull();
    expect(audited("tracked_item_attachment", "attachment_added")).toBe(true);
  });

  test("OAC bridge: promotes with evidence carried, once only, source row untouched", async () => {
    h.meetingActionItems.push({
      id: 77,
      bidId: 5,
      meetingId: 12,
      source: "meeting",
      description: "GC to submit revised RTU curb detail",
      assignedToName: "Josh",
      dueDate: new Date("2026-07-20"),
      priority: "HIGH",
      sourceText: "Owner asked for the curb detail by next OAC — see 00:41:20",
      carriedFromDate: "2026-07-01",
      notes: null,
    });
    const before = JSON.stringify(h.meetingActionItems[0]);

    const r = await promoteMeetingActionItem(5, 77, ACTOR);
    expect(r.ok).toBe(true);
    const item = h.items[0];
    expect(item.kind).toBe("OAC_ACTION");
    expect(item.sourceKind).toBe("meeting_action_item"); // canonical (legacy rows keep "meeting")
    expect(item.sourceMeetingId).toBe(12);
    expect(item.sourceMeetingActionItemId).toBe(77);
    expect(item.evidenceExcerpt).toMatch(/00:41:20/);
    expect(item.extractionMethod).toBe("meeting_analysis");
    expect(item.carriedFromDate).toBe("2026-07-01");
    expect(item.priority).toBe("HIGH");
    // the MeetingActionItem row was never mutated
    expect(JSON.stringify(h.meetingActionItems[0])).toBe(before);

    // duplicate promotion refused (friendly pre-check)
    const dup = await promoteMeetingActionItem(5, 77, ACTOR);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/only be promoted once/i);
    expect(h.items.length).toBe(1);

    // wrong-bid promotion refused (tenancy guard)
    const wrongBid = await promoteMeetingActionItem(6, 77, ACTOR);
    expect(wrongBid.ok).toBe(false);

    // audited as a promotion
    expect(audited("tracked_item_promote", "promoted_from_meeting_action_item")).toBe(true);
  });

  test("OAC bridge: unique-constraint race maps P2002 to the friendly duplicate error", async () => {
    h.meetingActionItems.push({
      id: 88,
      bidId: 5,
      meetingId: 12,
      source: "manual",
      description: "manual follow-up",
      priority: "MEDIUM",
      sourceText: null,
      carriedFromDate: null,
      notes: null,
    });
    // Simulate the race: pre-check misses (no item yet), create throws P2002.
    h.items.push({
      id: 999,
      bidId: 5,
      status: "OPEN",
      sourceMeetingActionItemId: 88,
    } as (typeof h.items)[number]);
    const findFirstSpy = (await import("@/lib/prisma")).prisma.trackedItem
      .findFirst as ReturnType<typeof vi.fn>;
    findFirstSpy.mockResolvedValueOnce(null); // pre-check says "not tracked"
    const r = await promoteMeetingActionItem(5, 88, ACTOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only be promoted once/i);
  });

  test("update: non-status fields only, validates priority and empty title", async () => {
    await createTrackedItem(5, { kind: "OM", title: "O&M manual for RTUs" }, ACTOR);
    const ok = await updateTrackedItem(5, 1, { assigneeName: "Mech Sub PM", priority: "HIGH" });
    expect(ok.ok).toBe(true);
    expect(h.items[0].assigneeName).toBe("Mech Sub PM");
    expect(audited("tracked_item_update", "updated")).toBe(true);
    expect((await updateTrackedItem(5, 1, { priority: "URGENT" })).ok).toBe(false);
    expect((await updateTrackedItem(5, 1, { title: "  " })).ok).toBe(false);
    expect((await updateTrackedItem(9, 1, { title: "x" })).ok).toBe(false);
  });

  // ── R2 remediation: audit atomicity ─────────────────────────────────────

  test("update on a nonexistent/foreign item emits NO committed audit (no false success)", async () => {
    await createTrackedItem(5, { kind: "OM", title: "manual" }, ACTOR);
    h.audits.length = 0;
    // not found in this bid
    const notFound = await updateTrackedItem(5, 999, { title: "ghost" });
    expect(notFound.ok).toBe(false);
    // invalid patch on an existing item
    const invalid = await updateTrackedItem(5, 1, { title: "   " });
    expect(invalid.ok).toBe(false);
    // cross-bid
    const crossBid = await updateTrackedItem(9, 1, { title: "x" });
    expect(crossBid.ok).toBe(false);
    // NONE of these produced an audit row or mutated the item.
    expect(h.audits.length).toBe(0);
    expect(h.items[0].title).toBe("manual");
  });

  test("audit-store failure rolls the whole create back (fail-closed)", async () => {
    const prisma = (await import("@/lib/prisma")).prisma as unknown as {
      auditEvent: { create: (a: unknown) => Promise<unknown> };
    };
    const realCreate = prisma.auditEvent.create;
    prisma.auditEvent.create = async () => {
      throw new Error("audit store down");
    };
    await expect(
      createTrackedItem(5, { kind: "WARRANTY", title: "letter" }, ACTOR)
    ).rejects.toThrow("audit store down");
    prisma.auditEvent.create = realCreate;
    // No TrackedItem row survived the failed audit.
    expect(h.items.length).toBe(0);
    expect(h.audits.length).toBe(0);
  });

  test("audit-store failure rolls back a status transition AND its closeout note", async () => {
    await createTrackedItem(5, { kind: "OAC_ACTION", title: "x" }, ACTOR);
    await transitionTrackedItem(5, 1, "IN_PROGRESS", ACTOR);
    h.audits.length = 0;

    const prisma = (await import("@/lib/prisma")).prisma as unknown as {
      auditEvent: { create: (a: unknown) => Promise<unknown> };
    };
    const realCreate = prisma.auditEvent.create;
    prisma.auditEvent.create = async () => {
      throw new Error("audit store down");
    };
    await expect(
      transitionTrackedItem(5, 1, "CLOSED", ACTOR, { note: "done" })
    ).rejects.toThrow("audit store down");
    prisma.auditEvent.create = realCreate;

    // Status stayed IN_PROGRESS, no closeout comment persisted, no audit row.
    expect(h.items[0].status).toBe("IN_PROGRESS");
    expect(h.comments.length).toBe(0);
    expect(h.audits.length).toBe(0);
  });
});

async function listAttachmentsSafe(bidId: number, itemId: number) {
  const { listAttachments } = await import("../index");
  return listAttachments(bidId, itemId);
}
