import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/services/meetingIntelligence/workerJobService", () => {
  const call = async () => {
    state.calls += 1;
    return { ok: true, value: { jobId: null }, leaseExpiresAt: new Date().toISOString() };
  };
  return {
    claimNextMeetingIntelligenceJob: call,
    heartbeatMeetingIntelligenceJob: call,
    reportMeetingIntelligenceProgress: call,
    failMeetingIntelligenceJob: call,
    completeMeetingIntelligenceJob: call,
    getMeetingIntelligenceJobMedia: call,
  };
});

import { POST as claimPOST } from "../claim/route";
import { POST as heartbeatPOST } from "../[jobId]/heartbeat/route";
import { POST as progressPOST } from "../[jobId]/progress/route";
import { POST as failPOST } from "../[jobId]/fail/route";
import { POST as completePOST } from "../[jobId]/complete/route";
import { GET as mediaGET } from "../[jobId]/media/route";

const params = { params: Promise.resolve({ jobId: "1" }) } as never;

function request(
  body: unknown = {},
  token?: string,
  method = "POST",
): Request {
  return new Request("http://local/api/worker/meeting-intelligence", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Meeting-Worker-Token": token } : {}),
      "X-Meeting-Worker-Lease": "lease-token",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  state.calls = 0;
  process.env.MEETING_WORKER_TOKEN = "controlled-test-worker-secret";
});

afterEach(() => {
  delete process.env.MEETING_WORKER_TOKEN;
});

describe("Meeting Intelligence worker authentication", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["claim", () => claimPOST(request({ workerId: "worker-a" }))],
    ["heartbeat", () => heartbeatPOST(request({ leaseToken: "lease-token" }), params)],
    ["progress", () => progressPOST(request({ leaseToken: "lease-token", stage: "transcribe", percent: 50 }), params)],
    ["fail", () => failPOST(request({ leaseToken: "lease-token", errorCode: "TEST", errorMessage: "test" }), params)],
    ["complete", () => completePOST(request({ leaseToken: "lease-token" }), params)],
    ["media", () => mediaGET(request({}, undefined, "GET"), params)],
  ];

  for (const [name, invoke] of cases) {
    it(`${name} rejects a missing token before service work`, async () => {
      const response = await invoke();
      expect(response.status).toBe(401);
      expect(state.calls).toBe(0);
    });
  }

  it("fails closed when the configured worker secret is absent", async () => {
    delete process.env.MEETING_WORKER_TOKEN;
    const response = await claimPOST(
      request({ workerId: "worker-a" }, "controlled-test-worker-secret"),
    );
    expect(response.status).toBe(401);
    expect(state.calls).toBe(0);
  });

  it("rejects an invalid secret and accepts the exact configured secret", async () => {
    expect(await claimPOST(request({ workerId: "worker-a" }, "wrong-secret"))).toMatchObject({ status: 401 });
    expect(state.calls).toBe(0);
    const response = await claimPOST(
      request({ workerId: "worker-a" }, "controlled-test-worker-secret"),
    );
    expect(response.status).toBe(200);
    expect(state.calls).toBe(1);
  });
});
