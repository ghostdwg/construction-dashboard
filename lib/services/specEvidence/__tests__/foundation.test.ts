import { mkdtempSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  parseDeterministicParagraphs,
  sha256Text,
} from "@/lib/services/specEvidence/paragraphs";
import {
  specRevisionStorageKey,
  specSectionStoragePrefix,
} from "@/lib/services/specbook/storagePath";

describe("deterministic Spec paragraph evidence", () => {
  test("produces stable labels, offsets, page fallback, and hashes", () => {
    const source =
      "1.7.B Contractor shall submit certificates.\nSupporting sentence.\n\nUnnumbered closeout text.";
    const first = parseDeterministicParagraphs(source, 12, 13);
    const replay = parseDeterministicParagraphs(source, 12, 13);

    expect(replay).toEqual(first);
    expect(first.map((row) => row.paragraphLabel)).toEqual(["1.7.B", "¶2"]);
    expect(first[0].text).toBe(source.slice(first[0].charStart, first[0].charEnd));
    expect(first[0].textSha256).toBe(sha256Text(first[0].text));
    expect(first[0]).toMatchObject({ pageNumber: 12, pageEnd: 13 });
  });

  test("builds immutable, collision-scoped source and section keys", () => {
    expect(specRevisionStorageKey(7, "source-revision-1", "book.pdf")).toBe(
      "plan-room/jobs/7/spec/source-revision-1/book.pdf",
    );
    expect(specSectionStoragePrefix(7, "source-revision-1", "evidence-run-1")).toBe(
      "plan-room/jobs/7/spec/source-revision-1/sections/evidence-run-1",
    );
    expect(() => specRevisionStorageKey(7, "../bad", "book.pdf")).toThrow(
      /immutable spec revision id/i,
    );
  });
});

describe("migrated Spec evidence integrity", () => {
  const root = mkdtempSync(join(tmpdir(), "gwx-spec-evidence-"));
  const databasePath = join(root, "foundation.db");
  const url = `file:${databasePath}`;
  let prisma: Awaited<typeof import("@/lib/prisma")>["prisma"];

  beforeAll(async () => {
    const sql = createClient({ url });
    const migrationRoot = join(process.cwd(), "prisma", "migrations");
    const names = (await readdir(migrationRoot))
      .filter((name) => /^\d/.test(name))
      .sort();
    for (const name of names) {
      await sql.executeMultiple(
        readFileSync(join(migrationRoot, name, "migration.sql"), "utf8"),
      );
    }
    await sql.close();
    process.env.DATABASE_URL = url;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).prisma;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  test("enforces revision order, one active source, ordered manifest, and supersession", async () => {
    const bid = await prisma.bid.create({
      data: { projectName: "Evidence project", createdById: "owner-1" },
    });
    const first = await prisma.specBook.create({
      data: {
        bidId: bid.id,
        fileName: "base-r1.pdf",
        filePath: "plan-room/jobs/1/spec/source-one/base-r1.pdf",
        status: "ready",
        revisionIndex: 1,
        effectiveState: "SUPERSEDED",
        sha256: "a".repeat(64),
        byteSize: 100,
        immutableId: "source-one",
      },
    });
    const second = await prisma.specBook.create({
      data: {
        bidId: bid.id,
        fileName: "base-r2.pdf",
        filePath: "plan-room/jobs/1/spec/source-two/base-r2.pdf",
        status: "ready",
        revisionIndex: 2,
        effectiveState: "EFFECTIVE",
        supersedesSpecBookId: first.id,
        sha256: "b".repeat(64),
        byteSize: 110,
        immutableId: "source-two",
        activeSlot: 1,
      },
    });
    await expect(
      prisma.specBook.create({
        data: {
          bidId: bid.id,
          fileName: "duplicate.pdf",
          filePath: "plan-room/jobs/1/spec/source-three/duplicate.pdf",
          revisionIndex: 2,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const addendumTwo = await prisma.addendumUpload.create({
      data: {
        bidId: bid.id,
        addendumNumber: 2,
        fileName: "a2.pdf",
        storageKey: "plan-room/jobs/1/addenda/addendum-two/a2.pdf",
        revisionIndex: 1,
        effectiveState: "EFFECTIVE",
        activeSlot: 1,
      },
    });
    const addendumOne = await prisma.addendumUpload.create({
      data: {
        bidId: bid.id,
        addendumNumber: 1,
        fileName: "a1.pdf",
        storageKey: "plan-room/jobs/1/addenda/addendum-one/a1.pdf",
        revisionIndex: 1,
        effectiveState: "EFFECTIVE",
        activeSlot: 1,
      },
    });
    const manifestJson = JSON.stringify({
      base: second.id,
      addenda: [addendumTwo.id, addendumOne.id],
    });
    const set = await prisma.specificationEffectiveSet.create({
      data: {
        bidId: bid.id,
        versionNumber: 1,
        baseSpecBookId: second.id,
        status: "PUBLISHED",
        manifestJson,
        manifestSha256: sha256Text(manifestJson),
        activeSlot: 1,
        addenda: {
          create: [
            { bidId: bid.id, addendumUploadId: addendumTwo.id, ordinal: 0 },
            { bidId: bid.id, addendumUploadId: addendumOne.id, ordinal: 1 },
          ],
        },
      },
      include: { addenda: { orderBy: { ordinal: "asc" } } },
    });
    expect(set.addenda.map((row) => row.addendumUploadId)).toEqual([
      addendumTwo.id,
      addendumOne.id,
    ]);
    await expect(
      prisma.specificationEffectiveSet.create({
        data: {
          bidId: bid.id,
          versionNumber: 2,
          baseSpecBookId: second.id,
          manifestJson: "{}",
          manifestSha256: sha256Text("{}"),
          activeSlot: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  test("retains paragraph citations and draft candidates with append-only decisions", async () => {
    const bid = await prisma.bid.findFirstOrThrow({
      where: { projectName: "Evidence project" },
    });
    const book = await prisma.specBook.findFirstOrThrow({
      where: { bidId: bid.id, activeSlot: 1 },
    });
    const set = await prisma.specificationEffectiveSet.findFirstOrThrow({
      where: { bidId: bid.id, activeSlot: 1 },
    });
    const section = await prisma.specSection.create({
      data: {
        specBookId: book.id,
        csiNumber: "01 78 00",
        csiTitle: "Closeout Submittals",
        rawText: "1.7.B Submit operation and maintenance data.",
      },
    });
    const evidence = await prisma.specSectionEvidenceRevision.create({
      data: {
        bidId: bid.id,
        specSectionId: section.id,
        revisionIndex: 1,
        rawText: section.rawText,
        textSha256: sha256Text(section.rawText),
      },
    });
    const [paragraph] = parseDeterministicParagraphs(section.rawText, 8, 8);
    const paragraphRow = await prisma.specParagraph.create({
      data: {
        bidId: bid.id,
        sectionEvidenceRevisionId: evidence.id,
        ...paragraph,
      },
    });
    const citation = await prisma.specCitation.create({
      data: {
        bidId: bid.id,
        effectiveSetId: set.id,
        sectionEvidenceRevisionId: evidence.id,
        specParagraphId: paragraphRow.id,
        sourceLocator: "Section 01 78 00, 1.7.B, p.8",
        evidenceExcerpt: paragraphRow.text,
        textSha256: paragraphRow.textSha256,
      },
    });
    const candidate = await prisma.specRequirementCandidate.create({
      data: {
        bidId: bid.id,
        effectiveSetId: set.id,
        citationId: citation.id,
        candidateGroupId: "candidate-group-1",
        revisionIndex: 1,
        requirementType: "CLOSEOUT",
        draftTitle: "O&M data",
        draftText: "Submit operation and maintenance data.",
        evidenceExcerpt: paragraphRow.text,
        sourceLocator: citation.sourceLocator,
      },
    });
    const decision = await prisma.specRequirementDecision.create({
      data: {
        bidId: bid.id,
        candidateId: candidate.id,
        decision: "ACCEPT",
        decidedBy: "owner-1",
      },
    });
    expect(citation.textSha256).toBe(sha256Text(paragraphRow.text));
    expect(candidate.reviewState).toBe("DRAFT");

    await expect(
      prisma.specRequirementDecision.update({
        where: { id: decision.id },
        data: { decision: "REJECT" },
      }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.specCitation.delete({ where: { id: citation.id } }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.specRequirementCandidate.update({
        where: { id: candidate.id },
        data: { draftText: "rewritten evidence" },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.specRequirementCandidate.update({
        where: { id: candidate.id },
        data: { reviewState: "ACCEPTED" },
      }),
    ).resolves.toMatchObject({ reviewState: "ACCEPTED" });
  });

  test("publishes ordered manifests atomically, supersedes once, and is retry-idempotent", async () => {
    process.env.OBSERVABILITY_AUDIT_QUIET = "true";
    const bid = await prisma.bid.findFirstOrThrow({
      where: { projectName: "Evidence project" },
    });
    const book = await prisma.specBook.findFirstOrThrow({
      where: { bidId: bid.id, activeSlot: 1 },
    });
    const addenda = await prisma.addendumUpload.findMany({
      where: { bidId: bid.id },
      orderBy: { addendumNumber: "asc" },
    });
    const orderedIds = addenda.map((row) => row.id);
    const { publishEffectiveSet } = await import(
      "@/lib/services/specEvidence/effectiveSets"
    );
    const published = await publishEffectiveSet({
      bidId: bid.id,
      baseSpecBookId: book.id,
      addendumUploadIds: orderedIds,
      actorUserId: "owner-1",
    });
    expect(published.versionNumber).toBe(2);
    await expect(
      prisma.specificationEffectiveSet.count({
        where: { bidId: bid.id, activeSlot: 1 },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.specificationEffectiveSet.findFirstOrThrow({
        where: { bidId: bid.id, versionNumber: 1 },
      }),
    ).resolves.toMatchObject({ status: "SUPERSEDED", activeSlot: null });

    const retried = await Promise.all([
      publishEffectiveSet({
        bidId: bid.id,
        baseSpecBookId: book.id,
        addendumUploadIds: orderedIds,
        actorUserId: "owner-1",
      }),
      publishEffectiveSet({
        bidId: bid.id,
        baseSpecBookId: book.id,
        addendumUploadIds: orderedIds,
        actorUserId: "owner-1",
      }),
    ]);
    expect(retried.map((row) => row.id)).toEqual([published.id, published.id]);
    await expect(
      prisma.specificationEffectiveSet.count({ where: { bidId: bid.id } }),
    ).resolves.toBe(2);
    await expect(
      prisma.auditEvent.count({
        where: { category: "spec_requirement", action: "publish_effective_set" },
      }),
    ).resolves.toBe(1);
  });

  test("fences AuditEvent history against update and delete", async () => {
    const event = await prisma.auditEvent.create({
      data: { category: "spec_requirement", action: "test_append_only" },
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: event.id },
        data: { action: "rewritten" },
      }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.auditEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/append-only/i);
  });

  test("extracts idempotent drafts with paragraph citations and creates no operational row", async () => {
    const bid = await prisma.bid.findFirstOrThrow({
      where: { projectName: "Evidence project" },
    });
    const set = await prisma.specificationEffectiveSet.findFirstOrThrow({
      where: { bidId: bid.id, activeSlot: 1 },
    });
    const section = await prisma.specSection.findFirstOrThrow({
      where: { specBookId: set.baseSpecBookId },
    });
    await prisma.specSection.update({
      where: { id: section.id },
      data: {
        aiExtractions: JSON.stringify({
          closeout: [{ title: "O&M manuals", requirement: "Submit operation and maintenance data." }],
        }),
      },
    });
    const before = await Promise.all([
      prisma.trackedItem.count({ where: { bidId: bid.id } }),
      prisma.submittalItem.count({ where: { bidId: bid.id } }),
      prisma.generatedQuestion.count({ where: { bidId: bid.id } }),
      prisma.meetingActionItem.count({ where: { bidId: bid.id } }),
    ]);
    const { extractDraftRequirementCandidates } = await import(
      "@/lib/services/specEvidence/candidates"
    );
    const first = await extractDraftRequirementCandidates({
      bidId: bid.id,
      effectiveSetId: set.id,
    });
    const replay = await extractDraftRequirementCandidates({
      bidId: bid.id,
      effectiveSetId: set.id,
    });
    const after = await Promise.all([
      prisma.trackedItem.count({ where: { bidId: bid.id } }),
      prisma.submittalItem.count({ where: { bidId: bid.id } }),
      prisma.generatedQuestion.count({ where: { bidId: bid.id } }),
      prisma.meetingActionItem.count({ where: { bidId: bid.id } }),
    ]);

    expect(first).toEqual({ created: 1, unchanged: 0 });
    expect(replay).toEqual({ created: 0, unchanged: 1 });
    expect(after).toEqual(before);
    await expect(
      prisma.specRequirementCandidate.findFirstOrThrow({
        where: { bidId: bid.id, candidateGroupId: { not: "candidate-group-1" } },
        include: { citation: true },
      }),
    ).resolves.toMatchObject({
      reviewState: "DRAFT",
      requirementType: "CLOSEOUT",
      citation: { specParagraphId: expect.any(Number) },
    });
  });

  test("rolls back a human decision when its in-transaction audit insert fails", async () => {
    const bid = await prisma.bid.findFirstOrThrow({
      where: { projectName: "Evidence project" },
    });
    const set = await prisma.specificationEffectiveSet.findFirstOrThrow({
      where: { bidId: bid.id, activeSlot: 1 },
    });
    const citation = await prisma.specCitation.findFirstOrThrow({
      where: { bidId: bid.id },
    });
    const candidate = await prisma.specRequirementCandidate.create({
      data: {
        bidId: bid.id,
        effectiveSetId: set.id,
        citationId: citation.id,
        candidateGroupId: "candidate-audit-rollback",
        revisionIndex: 1,
        requirementType: "TRAINING",
        draftTitle: "Training",
        draftText: "Provide training.",
        evidenceExcerpt: citation.evidenceExcerpt,
        sourceLocator: citation.sourceLocator,
      },
    });
    const sql = createClient({ url });
    await sql.executeMultiple(`
      CREATE TRIGGER "SpecEvidence_test_audit_failure"
      BEFORE INSERT ON "AuditEvent"
      WHEN NEW."action" = 'append_candidate_decision'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic audit failure');
      END;
    `);
    const { appendSpecRequirementDecision } = await import(
      "@/lib/services/specEvidence/decisions"
    );
    await expect(
      appendSpecRequirementDecision({
        bidId: bid.id,
        candidateId: candidate.id,
        decision: "ACCEPT",
        actorUserId: "owner-1",
      }),
    ).rejects.toThrow();
    await sql.execute(`DROP TRIGGER "SpecEvidence_test_audit_failure"`);
    await sql.close();

    await expect(
      prisma.specRequirementCandidate.findUniqueOrThrow({
        where: { id: candidate.id },
      }),
    ).resolves.toMatchObject({ reviewState: "DRAFT" });
    await expect(
      prisma.specRequirementDecision.count({
        where: { candidateId: candidate.id },
      }),
    ).resolves.toBe(0);
  });

  test("backfills legacy evidence replay-safely without inventing source hashes", async () => {
    const legacyBid = await prisma.bid.create({
      data: { projectName: "Legacy evidence", createdById: "owner-1" },
    });
    const legacyBook = await prisma.specBook.create({
      data: {
        bidId: legacyBid.id,
        fileName: "legacy.pdf",
        filePath: "plan-room/jobs/2/spec/original.pdf",
        status: "ready",
      },
    });
    await prisma.specSection.create({
      data: {
        specBookId: legacyBook.id,
        csiNumber: "01 33 00",
        csiTitle: "Submittal Procedures",
        rawText: "1.1.A Submit product data.\n\n1.1.B Submit samples.",
      },
    });
    await prisma.addendumUpload.create({
      data: {
        bidId: legacyBid.id,
        addendumNumber: 1,
        fileName: "legacy-addendum.pdf",
        status: "ready",
      },
    });
    const { runSpecEvidenceBackfill } = await import(
      "@/lib/services/specEvidence/backfill"
    );
    const first = await runSpecEvidenceBackfill(legacyBid.id);
    const replay = await runSpecEvidenceBackfill(legacyBid.id);

    expect(first).toEqual({
      specRevisions: 1,
      addendumRevisions: 1,
      effectiveSets: 1,
      sectionEvidenceRevisions: 1,
    });
    expect(replay).toEqual({
      specRevisions: 0,
      addendumRevisions: 0,
      effectiveSets: 0,
      sectionEvidenceRevisions: 0,
    });
    await expect(
      prisma.specBook.findUniqueOrThrow({ where: { id: legacyBook.id } }),
    ).resolves.toMatchObject({
      revisionIndex: 0,
      effectiveState: "EFFECTIVE",
      activeSlot: 1,
      sha256: null,
      byteSize: null,
    });
    await expect(
      prisma.specificationEffectiveSet.count({
        where: { bidId: legacyBid.id },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.specParagraph.count({ where: { bidId: legacyBid.id } }),
    ).resolves.toBe(2);
  });
});
