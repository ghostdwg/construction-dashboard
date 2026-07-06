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
// Also covers the storage-path-compat fix: each section's stored pdfPath is
// now resolved to a local absolute path via
// lib/services/specbook/storagePath.ts's resolveLocalPath() before the
// sidecar payload is built — see the "section PDF resolution" describe
// block below. Tests unrelated to resolution mock resolveLocalPath as an
// always-succeeding passthrough so they stay focused on the credential flow.
//
// No real HTTP call, no real DB — fetch, prisma, backgroundJobService, and
// storagePath are all mocked.

const SENTINEL = "sk-test-sentinel-do-not-use-67890";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  findFirst: vi.fn(),
  findActiveJobForBid: vi.fn(),
  createJob: vi.fn(),
  startJob: vi.fn(),
  failJob: vi.fn(),
  resolveLocalPath: vi.fn(),
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
vi.mock("@/lib/services/specbook/storagePath", () => ({
  resolveLocalPath: h.resolveLocalPath,
}));

import { triggerSpecAnalysis, TriggerError } from "../specAnalysisAutomation";

const SPEC_BOOK = {
  id: 7,
  sections: [
    { id: 101, csiNumber: "03 30 00", csiTitle: "Concrete", pdfPath: "plan-room/jobs/1/spec/sections/03.pdf" },
    { id: 102, csiNumber: "09 21 16", csiTitle: "Gypsum", pdfPath: "plan-room/jobs/1/spec/sections/09.pdf" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findActiveJobForBid.mockResolvedValue(null);
  h.findFirst.mockResolvedValue(SPEC_BOOK);
  h.createJob.mockResolvedValue({ id: "db-job-1" });
  h.startJob.mockResolvedValue({});
  h.failJob.mockResolvedValue({});
  // Default: every section's pdfPath resolves successfully to a synthetic
  // local absolute path derived from the (synthetic, non-sensitive) key —
  // tests that care about the exact resolved path override this per-case.
  h.resolveLocalPath.mockImplementation(async (ref: string) => ({
    ok: true,
    localPath: `/storage/${ref}`,
    kind: "canonical" as const,
    canonicalKey: ref,
  }));
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

describe("triggerSpecAnalysis — section PDF resolution before sidecar handoff", () => {
  it("5. sidecar payload carries each section's RESOLVED local absolute path in pdf_path, never the raw DB value", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "sidecar-job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });

    expect(result.status).toBe("triggered");
    expect(h.resolveLocalPath).toHaveBeenCalledWith("plan-room/jobs/1/spec/sections/03.pdf");
    expect(h.resolveLocalPath).toHaveBeenCalledWith("plan-room/jobs/1/spec/sections/09.pdf");

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.sections).toEqual([
      { csi: "03 30 00", title: "Concrete", pdf_path: "/storage/plan-room/jobs/1/spec/sections/03.pdf" },
      { csi: "09 21 16", title: "Gypsum", pdf_path: "/storage/plan-room/jobs/1/spec/sections/09.pdf" },
    ]);
    // Never the bare relative key it started from.
    for (const section of sentBody.sections) {
      expect(section.pdf_path).not.toBe("plan-room/jobs/1/spec/sections/03.pdf");
      expect(section.pdf_path).not.toBe("plan-room/jobs/1/spec/sections/09.pdf");
      expect(section.pdf_path.startsWith("/")).toBe(true);
    }

    vi.unstubAllGlobals();
  });

  it("6. an unresolvable section PDF fails the job explicitly via failJob and NEVER calls the sidecar fetch", async () => {
    h.getSetting.mockResolvedValue(SENTINEL);
    h.resolveLocalPath.mockImplementation(async (ref: string) => {
      if (ref === "plan-room/jobs/1/spec/sections/09.pdf") {
        return { ok: false, reason: "missing" };
      }
      return { ok: true, localPath: `/storage/${ref}`, kind: "canonical", canonicalKey: ref };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await triggerSpecAnalysis(1, { tier: 2, triggerSource: "user" });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(TriggerError);
    expect((thrown as TriggerError).httpStatus).toBe(404);
    expect((thrown as TriggerError).message).toMatch(/09 21 16.*unavailable.*missing/);

    // The durable BackgroundJob row was already created (createJob happens
    // before this resolution loop) — must be explicitly failed, not left
    // "queued"/orphaned.
    expect(h.failJob).toHaveBeenCalledTimes(1);
    expect(h.failJob).toHaveBeenCalledWith("db-job-1", expect.stringMatching(/09 21 16.*unavailable/));

    // No provider call: the sidecar (which is what triggers the actual
    // Anthropic call sidecar-side) must never be reached.
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
