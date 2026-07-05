import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline, mock-only tests for the N3 Option-A credential migration of
// spec_intelligence.py (docs/architecture/adr/0001-ai-credential-resolution.md)
// — the TS half of the fix.
//
// Before this migration, triggerSpecAnalysis() submitted a job to the
// sidecar's /parse/specs/analyze_split with NO credential at all (spec_
// intelligence.py resolved ANTHROPIC_API_KEY purely from its own process
// env — zero TS involvement). It now resolves the credential exclusively
// via getSetting() (DB-first, env-fallback) and forwards it as an explicit
// `api_key` field in the sidecar request body — never persisted into the
// durable BackgroundJob row (inputSummary/resultSummary/errorMessage are
// the only string fields written there, and none of them ever carry it).
//
// No real HTTP call, no real DB — fetch, prisma, and backgroundJobService
// are all mocked.

const SENTINEL = "sk-test-sentinel-do-not-use-67890";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  findFirst: vi.fn(),
  findActiveJobForBid: vi.fn(),
  createJob: vi.fn(),
  startJob: vi.fn(),
  failJob: vi.fn(),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({ getSetting: h.getSetting }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: { findFirst: h.findFirst },
  },
}));
vi.mock("../backgroundJobService", () => ({
  createJob: h.createJob,
  startJob: h.startJob,
  failJob: h.failJob,
  findActiveJobForBid: h.findActiveJobForBid,
}));

import { triggerSpecAnalysis, TriggerError } from "../specAnalysisAutomation";

const SPEC_BOOK = {
  id: 7,
  sections: [
    { id: 101, csiNumber: "03 30 00", csiTitle: "Concrete", pdfPath: "/tmp/03.pdf" },
    { id: 102, csiNumber: "09 21 16", csiTitle: "Gypsum", pdfPath: "/tmp/09.pdf" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findActiveJobForBid.mockResolvedValue(null);
  h.findFirst.mockResolvedValue(SPEC_BOOK);
  h.createJob.mockResolvedValue({ id: "db-job-1" });
  h.startJob.mockResolvedValue({});
  h.failJob.mockResolvedValue({});
});

describe("triggerSpecAnalysis — N3 Option-A credential migration", () => {
  it("1. sentinel credential resolved via getSetting() traverses verbatim across the fetch boundary to the sidecar's api_key field", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });

    expect(result.status).toBe("triggered");
    expect(h.getSetting).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.api_key).toBe(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("2. sentinel never leaks into the BackgroundJob create/start/fail calls, the returned outcome, or a thrown error's message", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });

    expect(JSON.stringify(result)).not.toContain(SENTINEL);

    // createJob is called BEFORE the sidecar fetch — assert its args never
    // carried the credential (it only ever takes jobType/bidId/relatedId/
    // inputSummary/triggerSource).
    expect(h.createJob).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.createJob.mock.calls[0][0])).not.toContain(SENTINEL);

    // startJob(dbJob.id, job_id) — only the sidecar's own job_id, never the key.
    expect(h.startJob).toHaveBeenCalledWith("db-job-1", "sidecar-job-1");

    expect(h.failJob).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("2b. sentinel never leaks into failJob's error message on sidecar failure", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "sidecar exploded" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(TriggerError);
    expect((thrown as TriggerError).message).not.toContain(SENTINEL);
    expect(h.failJob).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.failJob.mock.calls[0])).not.toContain(SENTINEL);

    vi.unstubAllGlobals();
  });

  it("3. fails closed with a controlled 503 TriggerError when getSetting() resolves to null — never touches the sidecar or creates a BackgroundJob row", async () => {
    h.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(TriggerError);
    expect((thrown as TriggerError).httpStatus).toBe(503);
    expect((thrown as TriggerError).message).toMatch(/ANTHROPIC_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.createJob).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("4. unrelated pre-existing guardrails (active job skip, missing spec book) are unaffected by the credential check", async () => {
    h.findActiveJobForBid.mockResolvedValue({ id: "existing", status: "running", externalJobId: "x" });
    const result = await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });
    expect(result.status).toBe("skipped");
    expect(h.getSetting).not.toHaveBeenCalled();
  });
});
