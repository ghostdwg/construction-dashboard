import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/services/meetingIntelligence/workerJobService", () => ({
  claimNextMeetingIntelligenceJob: vi.fn(async () => {
    state.calls += 1;
    return {
      ok: true,
      value: { jobId: null },
      leaseExpiresAt: new Date().toISOString(),
    };
  }),
}));

import { POST as claimWorkerJob } from "@/app/api/worker/meeting-intelligence/claim/route";

afterEach(() => {
  delete process.env.MEETING_WORKER_TOKEN;
  delete process.env.LEGACY_TRANSCRIPTION_ENABLED;
  delete process.env.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED;
});

it("leaves the v2 worker queue available when legacy permissions are absent or invalid", async () => {
  state.calls = 0;
  process.env.MEETING_WORKER_TOKEN = "controlled-test-worker-secret";
  delete process.env.LEGACY_TRANSCRIPTION_ENABLED;
  process.env.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED = "invalid";
  const request = new Request(
    "http://local/api/worker/meeting-intelligence/claim",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Meeting-Worker-Token": "controlled-test-worker-secret",
      },
      body: JSON.stringify({ workerId: "worker-a" }),
    },
  );

  const response = await claimWorkerJob(request);

  expect(response.status).toBe(200);
  expect(state.calls).toBe(1);
});
