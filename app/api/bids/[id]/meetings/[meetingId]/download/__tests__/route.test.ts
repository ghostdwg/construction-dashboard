import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  row: {
    audioFileName: "meeting.wav",
    audioStorageKey: "plan-room/jobs/1/meetings/9/immutable/meeting.wav",
  } as null | { audioFileName: string | null; audioStorageKey: string | null },
}));
const findFirst = vi.hoisted(() => vi.fn());
const readBuffer = vi.hoisted(() => vi.fn());
const stat = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () =>
    state.denied
      ? { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) }
      : { ok: true, user: { id: "u1", role: "pm" } },
  ),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { meeting: { findFirst } } }));
vi.mock("@/lib/storage/blobStore", () => ({ getBlobStore: () => ({ stat }) }));
vi.mock("@/lib/services/meetings/storagePath", () => ({
  readMeetingStorageBuffer: readBuffer,
  classifyMeetingStoragePath: (ref: string) =>
    ref.startsWith("plan-room/")
      ? { kind: "canonical", canonicalKey: ref }
      : { kind: "legacy-cwd" },
  meetingMediaContentType: (_name: string, stored?: string) => stored ?? "audio/wav",
}));

import { GET } from "../route";

const params = { params: Promise.resolve({ id: "1", meetingId: "9" }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  state.row = {
    audioFileName: "meeting.wav",
    audioStorageKey: "plan-room/jobs/1/meetings/9/immutable/meeting.wav",
  };
  findFirst.mockImplementation(async () => state.row);
  readBuffer.mockResolvedValue(Buffer.from("meeting bytes"));
  stat.mockResolvedValue({ contentType: "audio/wav", size: 13 });
});

describe("meeting media private download", () => {
  test("serves canonical media using persisted content type", async () => {
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("meeting bytes");
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("serves a legacy reconstructed path through the compatibility reader", async () => {
    state.row = { audioFileName: "legacy.wav", audioStorageKey: null };
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(200);
    const [ref, bidId, meetingId] = readBuffer.mock.calls[0];
    expect(ref).toContain("uploads/meetings/9/legacy.wav");
    expect([bidId, meetingId]).toEqual([1, 9]);
    expect(stat).not.toHaveBeenCalled();
  });

  test("denied, cross-bid, and missing-media requests do not become path oracles", async () => {
    state.denied = true;
    expect((await GET(new Request("http://local"), params)).status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
    expect(readBuffer).not.toHaveBeenCalled();

    state.denied = false;
    state.row = null;
    expect((await GET(new Request("http://local"), params)).status).toBe(404);
    state.row = { audioFileName: "meeting.wav", audioStorageKey: "plan-room/jobs/1/meetings/9/x/meeting.wav" };
    readBuffer.mockRejectedValueOnce(new Error("missing"));
    expect((await GET(new Request("http://local"), params)).status).toBe(404);
  });
});
