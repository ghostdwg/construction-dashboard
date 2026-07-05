import { beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  Work Package N5 — Sidecar AI usage evidence, wired into the Spec Book
//  analysis completion webhook.
//
//  Confirms:
//   1. A successful callback with pass2_usage persists exactly one
//      AiUsageLog row with model(s)/tokens/cost/bidId — the durable evidence
//      contract — and nothing else.
//   2. Sensitive shapes the sidecar payload carries elsewhere (per-section
//      `analysis`, csi/title text) never reach the AiUsageLog row.
//   3. A callback with no pass2_usage (e.g. older/error shapes) does not
//      fabricate a usage row.
// ──────────────────────────────────────────────────────────────────────────

const db = {
  specBook: { id: 7 } as { id: number } | null,
  sections: [{ id: 101, csiNumber: "033000" }] as Array<{ id: number; csiNumber: string }>,
  updatedSections: [] as Array<{ id: number; aiExtractions: string | null }>,
  usageLogCreates: [] as Array<Record<string, unknown>>,
};

function resetDb() {
  db.specBook = { id: 7 };
  db.sections = [{ id: 101, csiNumber: "033000" }];
  db.updatedSections = [];
  db.usageLogCreates = [];
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: {
      findFirst: vi.fn(async () => db.specBook),
    },
    specSection: {
      findMany: vi.fn(async () => db.sections),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: { aiExtractions: string | null } }) => {
        db.updatedSections.push({ id: where.id, aiExtractions: data.aiExtractions });
        return { id: where.id, ...data };
      }),
    },
    aiUsageLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.usageLogCreates.push(data);
        return { id: db.usageLogCreates.length, ...data };
      }),
    },
  },
}));

vi.mock("@/lib/services/submittal/generateFromAiAnalysis", () => ({
  generateSubmittalsFromAiAnalysis: vi.fn(async () => ({ created: 0 })),
}));

vi.mock("@/lib/services/jobs/backgroundJobService", () => ({
  findJobByExternalId: vi.fn(async () => null),
  completeJob: vi.fn(async () => ({})),
  failJob: vi.fn(async () => ({})),
}));

const routeParams = { params: Promise.resolve({ id: "7" }) };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/bids/7/specbook/analyze/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/bids/[id]/specbook/analyze/complete — AI usage evidence", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  test("persists usage evidence (model/tokens/cost/bidId) with no sensitive fields", async () => {
    const { POST } = await import("../route");

    const res = await POST(
      makeRequest({
        job_id: "sidecar-job-1",
        status: "complete",
        result: {
          sections: [
            {
              csi: "03 30 00",
              title: "CAST-IN-PLACE CONCRETE",
              analysis: { severity: "HIGH", description: "some analysis text" },
            },
          ],
          section_count: 1,
          summary: { total: 1, critical: 0, high: 1, moderate: 0, low: 0, info: 0 },
          total_cost: 0.0456,
          pass2_usage: {
            total_input: 8000,
            total_output: 1200,
            total_cost: 0.0456,
            sections_analyzed: 1,
            sonnet_sections: 1,
            haiku_sections: 0,
            models: ["claude-sonnet-4-6"],
          },
        },
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(true);

    expect(db.usageLogCreates).toHaveLength(1);
    const row = db.usageLogCreates[0];

    expect(row).toEqual({
      callKey: "spec_analysis_sidecar",
      model: "claude-sonnet-4-6",
      inputTokens: 8000,
      outputTokens: 1200,
      costUsd: 0.0456,
      bidId: 7,
      status: "ok",
      errorMessage: null,
    });

    // No prompt text, section analysis payloads, csi/title strings, or any
    // credential-shaped field ever reaches the persisted usage row. (The
    // callKey legitimately contains the substring "analysis" as part of its
    // feature name, so it's excluded from this content check.)
    expect(Object.keys(row)).not.toContain("analysis");
    const contentOnly = JSON.stringify({ ...row, callKey: undefined });
    expect(contentOnly).not.toMatch(/severity|description|CAST-IN-PLACE|apiKey|token_secret/i);
  });

  test("joins multiple reported model ids into one column value", async () => {
    const { POST } = await import("../route");

    await POST(
      makeRequest({
        job_id: "sidecar-job-2",
        status: "complete",
        result: {
          sections: [],
          section_count: 0,
          summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
          total_cost: 0.09,
          pass2_usage: {
            total_input: 10000,
            total_output: 2000,
            total_cost: 0.09,
            sections_analyzed: 2,
            sonnet_sections: 1,
            haiku_sections: 1,
            models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
          },
        },
      }),
      routeParams
    );

    expect(db.usageLogCreates).toHaveLength(1);
    expect(db.usageLogCreates[0].model).toBe("claude-haiku-4-5-20251001, claude-sonnet-4-6");
  });

  test("does not fabricate a usage row when the sidecar reports no pass2_usage", async () => {
    const { POST } = await import("../route");

    const res = await POST(
      makeRequest({
        job_id: "sidecar-job-3",
        status: "complete",
        result: {
          sections: [],
          section_count: 0,
          summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
          total_cost: 0,
        },
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    expect(db.usageLogCreates).toHaveLength(0);
  });

  test("does not persist usage on a sidecar-reported job failure (no usage numbers available)", async () => {
    const { POST } = await import("../route");

    const res = await POST(
      makeRequest({
        job_id: "sidecar-job-4",
        status: "error",
        error: "provider timeout",
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(false);
    expect(db.usageLogCreates).toHaveLength(0);
  });
});
