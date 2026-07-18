import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

let db: (typeof import("@/lib/prisma"))["prisma"];
let packages: typeof import("../packages");
let observations: typeof import("../observations");
let attachments: typeof import("../attachments");
let rateLimit: typeof import("../rateLimit");
let testDir = "";
let previousDatabaseUrl: string | undefined;

const actor = { id: "synthetic-gc" };

async function seedBid(label: string) {
  const bid = await db.bid.create({ data: { projectName: `Synthetic ${label}` } });
  const contractor = await db.subcontractor.create({ data: { company: `Synthetic contractor ${label}` } });
  await db.bidInviteSelection.create({ data: { bidId: bid.id, subcontractorId: contractor.id } });
  const trackedItem = await db.trackedItem.create({ data: { bidId: bid.id, kind: "FIELD_ITEM", title: `Synthetic item ${label}`, extractionMethod: "manual" } });
  return { bid, contractor, trackedItem };
}

beforeAll(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), "gwx-r2b2-migrated-test-"));
  const databaseUrl = `file:${path.join(testDir, "migration.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, APP_ENV: "local", DATABASE_URL: databaseUrl },
    stdio: "ignore",
  });
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ENV = "local";
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ prisma: db } = await import("@/lib/prisma"));
  packages = await import("../packages");
  observations = await import("../observations");
  attachments = await import("../attachments");
  rateLimit = await import("../rateLimit");
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (testDir) await rm(testDir, { recursive: true, force: true });
});

describe.sequential("R2 Build 2 migrated-database reviewer repairs", () => {
  test("durable Bid/source/contractor history resists deletion and preserves every source invariant", async () => {
    const { bid, contractor, trackedItem } = await seedBid("retention");
    const fieldReport = await db.fieldReport.create({ data: { bidId: bid.id, title: "Synthetic field source" } });
    const consultantReport = await db.consultantReport.create({ data: { bidId: bid.id, vendorName: "Synthetic consultant", reportType: "OTHER_CONSULTANT_REPORT" } });
    const fieldObservation = await db.reportObservation.create({ data: { bidId: bid.id, sourceKind: "field_report", fieldReportId: fieldReport.id, observationText: "Field evidence" } });
    await db.reportObservation.create({ data: { bidId: bid.id, sourceKind: "consultant_report", consultantReportId: consultantReport.id, observationText: "Consultant evidence" } });
    await db.reportObservation.create({ data: { bidId: bid.id, sourceKind: "direct_entry", observationText: "Direct evidence" } });
    await expect(db.reportObservation.create({ data: { bidId: bid.id, sourceKind: "field_report", observationText: "Invalid source" } })).rejects.toThrow();
    await db.trackedItem.update({ where: { id: trackedItem.id }, data: { responsibleContractorId: contractor.id, sourceReportObservationId: fieldObservation.id } });
    await db.reportObservation.update({ where: { id: fieldObservation.id }, data: { registerItemId: trackedItem.id } });
    const pkg = await db.responsePackage.create({ data: { bidId: bid.id, packageNumber: 1, title: "Retained package", contractorId: contractor.id, createdBy: "synthetic" } });
    const member = await db.responsePackageItem.create({ data: { bidId: bid.id, packageId: pkg.id, trackedItemId: trackedItem.id } });
    const revision = await db.tradeResponseRevision.create({ data: { bidId: bid.id, packageItemId: member.id, responseType: "COMPLETED", responseText: "Immutable bytes", responderName: "Synthetic responder" } });
    await db.tradeResponseAttachment.create({ data: { bidId: bid.id, responseRevisionId: revision.id, storageKey: `plan-room/jobs/${bid.id}/response-packages/${pkg.id}/proof.pdf`, fileName: "proof.pdf", mimeType: "application/pdf", byteSize: 4 } });
    await db.responseAccessToken.create({ data: { bidId: bid.id, packageId: pkg.id, tokenHash: packages.hashResponseToken("synthetic-retained-token"), expiresAt: new Date(Date.now() + 60_000), createdBy: "synthetic" } });
    await db.tradeResponseReviewDecision.create({ data: { bidId: bid.id, responseRevisionId: revision.id, decision: "ACCEPTED_FOR_TRANSMITTAL", commentary: "Retained detail", reviewedBy: "synthetic" } });

    await expect(db.fieldReport.delete({ where: { id: fieldReport.id } })).rejects.toThrow();
    await expect(db.consultantReport.delete({ where: { id: consultantReport.id } })).rejects.toThrow();
    await expect(db.subcontractor.delete({ where: { id: contractor.id } })).rejects.toThrow();
    await expect(db.bid.delete({ where: { id: bid.id } })).rejects.toThrow();
    expect(await db.reportObservation.count({ where: { bidId: bid.id } })).toBe(3);
    expect(await db.tradeResponseRevision.count({ where: { bidId: bid.id } })).toBe(1);
    expect(await db.tradeResponseAttachment.count({ where: { bidId: bid.id } })).toBe(1);
    expect(await db.responseAccessToken.count({ where: { bidId: bid.id } })).toBe(1);
    expect(await db.tradeResponseReviewDecision.count({ where: { bidId: bid.id } })).toBe(1);
  }, 30_000);

  test("real concurrent numbering, revision allocation, disposition, promotion, issue, and FSM claims are bounded and honest", async () => {
    const { bid, contractor, trackedItem } = await seedBid("concurrency");
    const createdPackages = await Promise.all([
      packages.createResponsePackage(bid.id, { title: "Concurrent A", contractorId: contractor.id }, actor),
      packages.createResponsePackage(bid.id, { title: "Concurrent B", contractorId: contractor.id }, actor),
    ]);
    expect(createdPackages.every((result) => result.ok)).toBe(true);
    expect((await db.responsePackage.findMany({ where: { bidId: bid.id }, orderBy: { packageNumber: "asc" }, select: { packageNumber: true } })).map((row) => row.packageNumber)).toEqual([1, 2]);

    const observation = await observations.createReportObservation(bid.id, { sourceKind: "direct_entry", observationText: "Concurrent provenance" }, actor);
    expect(observation.ok).toBe(true);
    if (!observation.ok) return;
    const dispositions = await Promise.all([
      observations.dispositionObservation(bid.id, observation.value.id, { disposition: "ACCEPTED" }, actor),
      observations.dispositionObservation(bid.id, observation.value.id, { disposition: "INFORMATIONAL" }, actor),
    ]);
    expect(dispositions.filter((result) => result.ok)).toHaveLength(1);
    const promoted = await Promise.all([
      observations.promoteObservation(bid.id, observation.value.id, {}, actor),
      observations.promoteObservation(bid.id, observation.value.id, {}, actor),
    ]);
    expect(promoted.every((result) => result.ok)).toBe(true);
    if (!promoted[0].ok || !promoted[1].ok) return;
    expect(promoted[0].value.trackedItemId).toBe(promoted[1].value.trackedItemId);
    expect(await db.trackedItem.count({ where: { sourceReportObservationId: observation.value.id } })).toBe(1);

    const targetPackage = createdPackages[0];
    if (!targetPackage.ok) return;
    await db.responsePackageItem.create({ data: { bidId: bid.id, packageId: targetPackage.value.id, trackedItemId: trackedItem.id } });
    const issued = await Promise.all([
      packages.issueResponsePackage(bid.id, targetPackage.value.id, { delivery: "PORTAL" }, actor),
      packages.issueResponsePackage(bid.id, targetPackage.value.id, { delivery: "PORTAL" }, actor),
    ]);
    expect(issued.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.responseAccessToken.count({ where: { packageId: targetPackage.value.id } })).toBe(1);

    const member = await db.responsePackageItem.findFirstOrThrow({ where: { packageId: targetPackage.value.id } });
    const revisions = await Promise.all([
      packages.submitManualResponse(bid.id, targetPackage.value.id, member.id, { responderName: "One", channel: "EMAIL", responseType: "COMPLETED", responseText: "First concurrent bytes" }, actor),
      packages.submitManualResponse(bid.id, targetPackage.value.id, member.id, { responderName: "Two", channel: "EMAIL", responseType: "COMPLETED", responseText: "Second concurrent bytes" }, actor),
    ]);
    expect(revisions.every((result) => result.ok)).toBe(true);
    expect((await db.tradeResponseRevision.findMany({ where: { packageItemId: member.id }, orderBy: { revisionIndex: "asc" }, select: { revisionIndex: true } })).map((row) => row.revisionIndex)).toEqual([0, 1]);
    const transitions = await Promise.all([
      packages.transitionResponsePackage(bid.id, targetPackage.value.id, "RESPONSES_IN", actor),
      packages.transitionResponsePackage(bid.id, targetPackage.value.id, "VOIDED", actor),
    ]);
    const successfulTransitions = transitions.filter((result) => result.ok).length;
    const transitionAudits = await db.auditEvent.findMany({ where: { action: "response_package_transition", subjectId: String(targetPackage.value.id) }, orderBy: { emittedAt: "asc" } });
    expect(transitionAudits).toHaveLength(successfulTransitions);
    const payloads = transitionAudits.map((audit) => JSON.parse(audit.payloadJson ?? "{}") as { from?: string; to?: string });
    expect(payloads.filter((payload) => payload.from === "ISSUED")).toHaveLength(1);
    if (payloads.length === 2) expect(payloads).toEqual([expect.objectContaining({ from: "ISSUED", to: "RESPONSES_IN" }), expect.objectContaining({ from: "RESPONSES_IN", to: "VOIDED" })]);
  }, 30_000);

  test("invalid discriminants do not mutate, VOID kills attachment access, review corrections append, and limiter is shared/bounded", async () => {
    const { bid, contractor, trackedItem } = await seedBid("security");
    const pkg = await db.responsePackage.create({ data: { bidId: bid.id, packageNumber: 1, title: "Security package", contractorId: contractor.id, createdBy: "synthetic" } });
    const member = await db.responsePackageItem.create({ data: { bidId: bid.id, packageId: pkg.id, trackedItemId: trackedItem.id } });
    const baselineAudit = await db.auditEvent.count();
    expect(await packages.issueResponsePackage(bid.id, pkg.id, { delivery: "BOGUS", manualChannel: "EMAIL" }, actor)).toEqual({ ok: false, error: "Invalid delivery mechanism" });
    expect(await packages.changePackageItem(bid.id, pkg.id, { action: "BOGUS", trackedItemId: trackedItem.id }, actor)).toEqual({ ok: false, error: "Invalid package item action" });
    expect((await db.responsePackage.findUniqueOrThrow({ where: { id: pkg.id } })).status).toBe("DRAFT");
    expect(await db.responsePackageItem.count({ where: { packageId: pkg.id } })).toBe(1);
    expect(await db.auditEvent.count()).toBe(baselineAudit);

    const issued = await packages.issueResponsePackage(bid.id, pkg.id, { delivery: "PORTAL" }, actor);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const response = await packages.submitManualResponse(bid.id, pkg.id, member.id, { responderName: "Synthetic", channel: "EMAIL", responseType: "COMPLETED", responseText: "Retained response" }, actor);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const attachment = await db.tradeResponseAttachment.create({ data: { bidId: bid.id, responseRevisionId: response.value.id, storageKey: `plan-room/jobs/${bid.id}/response-packages/${pkg.id}/proof.pdf`, fileName: "proof.pdf", mimeType: "application/pdf", byteSize: 4 } });
    expect((await attachments.findExternalResponseAttachment(issued.value.rawToken!, attachment.id)).ok).toBe(true);
    expect((await packages.transitionResponsePackage(bid.id, pkg.id, "VOIDED", actor)).ok).toBe(true);
    expect(await attachments.findExternalResponseAttachment(issued.value.rawToken!, attachment.id)).toEqual({ ok: false, error: "Not found" });
    expect((await db.responseAccessToken.findFirstOrThrow({ where: { packageId: pkg.id } })).revokedAt).toBeInstanceOf(Date);

    const reviewPackage = await db.responsePackage.create({ data: { bidId: bid.id, packageNumber: 2, title: "Review package", contractorId: contractor.id, status: "GC_REVIEW", createdBy: "synthetic" } });
    const reviewMember = await db.responsePackageItem.create({ data: { bidId: bid.id, packageId: reviewPackage.id, trackedItemId: trackedItem.id } });
    const reviewRevision = await db.tradeResponseRevision.create({ data: { bidId: bid.id, packageItemId: reviewMember.id, responderName: "Synthetic", responseType: "COMPLETED", responseText: "Contractor bytes" } });
    expect((await packages.reviewTradeResponse(bid.id, reviewPackage.id, reviewMember.id, reviewRevision.id, { gcReview: "RETURNED_FOR_REVISION", gcCommentary: "First retained commentary" }, actor)).ok).toBe(true);
    expect((await packages.reviewTradeResponse(bid.id, reviewPackage.id, reviewMember.id, reviewRevision.id, { gcReview: "ACCEPTED_FOR_TRANSMITTAL", gcCommentary: "Corrected retained commentary" }, actor)).ok).toBe(true);
    const decisions = await db.tradeResponseReviewDecision.findMany({ where: { responseRevisionId: reviewRevision.id }, orderBy: { id: "asc" } });
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ commentary: "First retained commentary", correctionOfId: null });
    expect(decisions[1]).toMatchObject({ commentary: "Corrected retained commentary", correctionOfId: decisions[0].id });

    expect(await rateLimit.checkExternalRateLimit(issued.value.rawToken!)).toBe(true);
    let unknownAllowed = 0;
    for (let index = 0; index < 100; index += 1) {
      if (await rateLimit.checkExternalRateLimit(`unknown-${index}`)) unknownAllowed += 1;
    }
    expect(unknownAllowed).toBe(rateLimit.EXTERNAL_RATE_LIMIT_MAX_REQUESTS);
    expect(await db.externalResponseRateLimitBucket.count()).toBe(2);
    const later = new Date(Date.now() + rateLimit.EXTERNAL_RATE_LIMIT_WINDOW_MS + 1);
    expect(await rateLimit.checkExternalRateLimit("unknown-after-expiry", later)).toBe(true);
    expect(await db.externalResponseRateLimitBucket.count()).toBe(1);
  }, 30_000);
});
