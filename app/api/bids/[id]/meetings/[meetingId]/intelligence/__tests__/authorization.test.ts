import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ denied: false, serviceCalls: 0 }));

vi.mock("@/lib/services/meetingRegister/routeHelpers", () => ({
  meetingRouteContext: vi.fn(async () =>
    state.denied
      ? {
          ok: false,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        }
      : {
          ok: true,
          bidId: 1,
          meetingId: 5,
          actor: { id: "u1", name: "Reviewer" },
        },
  ),
}));

vi.mock("@/lib/services/meetingIntelligence/service", () => {
  const called = async () => {
    state.serviceCalls += 1;
    return { ok: true, value: {} };
  };
  return {
    meetingIntelligenceServiceStatus: () => 400,
    queueMeetingIntelligence: called,
    processQueuedMeetingIntelligence: called,
    cancelMeetingIntelligence: called,
    reviewMeetingIntelligenceCandidate: called,
    publishMeetingIntelligenceCandidate: called,
    correctMeetingIntelligenceSpeaker: called,
  };
});
vi.mock("@/lib/services/meetingIntelligence/workerJobService", () => ({
  retryMeetingIntelligence: vi.fn(async () => {
    state.serviceCalls += 1;
    return { ok: true, value: {} };
  }),
}));

import { POST as queuePOST } from "../queue/route";
import { POST as processPOST } from "../process/route";
import { POST as cancelPOST } from "../cancel/route";
import { POST as retryPOST } from "../retry/route";
import { PATCH as reviewPATCH } from "../candidates/[candidateId]/route";
import { POST as publishPOST } from "../candidates/[candidateId]/publish/route";
import { PATCH as speakerPATCH } from "../segments/[segmentId]/route";

const request = (body: unknown = {}) =>
  new Request("http://local/intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const params = (extra: Record<string, string> = {}) =>
  ({
    params: Promise.resolve({ id: "1", meetingId: "5", ...extra }),
  }) as never;

beforeEach(() => {
  state.denied = false;
  state.serviceCalls = 0;
});

describe("Meeting Intelligence mutation authorization", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["queue", () => queuePOST(request(), params())],
    ["process", () => processPOST(request({ artifactId: 1, fixtureText: "secret" }), params())],
    ["cancel", () => cancelPOST(request({ artifactId: 1 }), params())],
    ["retry", () => retryPOST(request({ artifactId: 1 }), params())],
    [
      "review",
      () => reviewPATCH(request({ action: "ACCEPT" }), params({ candidateId: "1" })),
    ],
    ["publish", () => publishPOST(request(), params({ candidateId: "1" }))],
    [
      "speaker correction",
      () => speakerPATCH(request({ speakerLabel: "SPEAKER_2" }), params({ segmentId: "1" })),
    ],
  ];

  for (const [name, invoke] of cases) {
    it(`${name} is denied before service work`, async () => {
      state.denied = true;
      const response = await invoke();
      expect(response.status).toBe(403);
      expect(state.serviceCalls).toBe(0);
    });
  }
});
