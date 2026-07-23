import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "pm" } as { id: string; role: string } | null,
  allowedBidId: 1,
  prisma: null as unknown as Record<string, unknown>,
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn(async () => {
    if (!h.user) throw Response.json({ error: "Authentication required" }, { status: 401 });
    return h.user;
  }),
  bidScopeFilter: vi.fn((user: { id: string }) => ({ createdById: user.id })),
  requireBidAccess: vi.fn(async (bidId: number) => h.user && bidId === h.allowedBidId
    ? { ok: true, user: h.user }
    : { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) }),
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return h.prisma;
  },
}));

process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { GET, POST } from "../route";
import { DELETE, PATCH } from "../[id]/route";

function task(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-22T12:00:00.000Z");
  return {
    id: 10,
    bidId: 1,
    meetingId: 5,
    source: "meeting",
    description: "Install flashing",
    assignedToName: null,
    dueDate: null,
    priority: "MEDIUM",
    status: "OPEN",
    isGcTask: false,
    carriedFromDate: null,
    closedAt: null,
    notes: null,
    sourceText: "Transcript evidence",
    sourceMeetingIntelligenceCandidateId: 7,
    createdAt: now,
    updatedAt: now,
    bid: { id: 1, projectName: "Project", location: null },
    meeting: { id: 5, title: "OAC", meetingDate: now },
    ...overrides,
  };
}

beforeEach(() => {
  h.user = { id: "u1", role: "pm" };
  h.allowedBidId = 1;
  const current = task();
  const meetingActionItem = {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => current),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => task({ ...data, id: 11 })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => task({ ...current, ...data })),
    delete: vi.fn(async () => current),
  };
  const auditEvent = { create: vi.fn(async () => ({})) };
  h.prisma = {
    meetingActionItem,
    auditEvent,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ meetingActionItem, auditEvent })),
  };
});

const params = (id = "10") => ({ params: Promise.resolve({ id }) });

describe("Tasks authorization and publication boundary", () => {
  it("returns 401 for an anonymous register request without querying tasks", async () => {
    h.user = null;
    const response = await GET(new Request("http://local/api/tasks"));
    expect(response.status).toBe(401);
    expect((h.prisma.meetingActionItem as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
  });

  it("returns 401 for anonymous task creation, update, and deletion", async () => {
    h.user = null;
    const createResponse = await POST(new Request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId: 1, description: "No session" }),
    }));
    const updateResponse = await PATCH(new Request("http://local/api/tasks/10", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    }), params());
    const deleteResponse = await DELETE(new Request("http://local/api/tasks/10", { method: "DELETE" }), params());
    expect([createResponse.status, updateResponse.status, deleteResponse.status]).toEqual([401, 401, 401]);
  });

  it("scopes the cross-project register through the caller's bid ownership", async () => {
    const response = await GET(new Request("http://local/api/tasks?status=all"));
    expect(response.status).toBe(200);
    expect((h.prisma.meetingActionItem as { findMany: ReturnType<typeof vi.fn> }).findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bid: { createdById: "u1" } }),
    }));
  });

  it("denies cross-bid create and update before a task mutation", async () => {
    h.allowedBidId = 99;
    const createResponse = await POST(new Request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId: 1, description: "Other project" }),
    }));
    expect(createResponse.status).toBe(403);

    const updateResponse = await PATCH(new Request("http://local/api/tasks/10", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    }), params());
    const deleteResponse = await DELETE(new Request("http://local/api/tasks/10", { method: "DELETE" }), params());
    expect(updateResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
    expect((h.prisma.meetingActionItem as { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
    expect((h.prisma.meetingActionItem as { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    expect((h.prisma.meetingActionItem as { delete: ReturnType<typeof vi.fn> }).delete).not.toHaveBeenCalled();
  });

  it("refuses deletion of a Meeting Intelligence-published task and preserves the link", async () => {
    const response = await DELETE(new Request("http://local/api/tasks/10", { method: "DELETE" }), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("cannot be deleted") });
    expect((h.prisma.meetingActionItem as { delete: ReturnType<typeof vi.fn> }).delete).not.toHaveBeenCalled();
  });

  it("updates supported fields and writes an audit event in the same transaction", async () => {
    const response = await PATCH(new Request("http://local/api/tasks/10", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToName: "Morgan Lee", dueDate: "2026-08-01", priority: "HIGH", status: "CLOSED", notes: "Confirmed" }),
    }), params());
    expect(response.status).toBe(200);
    expect((h.prisma.meetingActionItem as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledOnce();
    expect((h.prisma.auditEvent as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledOnce();
  });
});
