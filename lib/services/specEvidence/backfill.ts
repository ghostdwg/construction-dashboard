import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendSectionEvidenceTx } from "./evidence";
import { sha256Text } from "./paragraphs";

export type SpecEvidenceBackfillResult = {
  specRevisions: number;
  addendumRevisions: number;
  effectiveSets: number;
  sectionEvidenceRevisions: number;
};

/**
 * Replay-safe application backfill. It never reads source blobs and never
 * invents source hashes; historic sha256/byteSize values remain NULL.
 */
export async function runSpecEvidenceBackfill(
  bidId: number,
): Promise<SpecEvidenceBackfillResult> {
  const result: SpecEvidenceBackfillResult = {
    specRevisions: 0,
    addendumRevisions: 0,
    effectiveSets: 0,
    sectionEvidenceRevisions: 0,
  };
  const bids = await prisma.bid.findMany({
    where: { id: bidId, specBooks: { some: {} } },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  for (const bid of bids) {
    await prisma.$transaction(async (tx) => {
      let activeSpec = await tx.specBook.findFirst({
        where: { bidId: bid.id, activeSlot: 1 },
        orderBy: { uploadedAt: "desc" },
      });
      if (!activeSpec) {
        const latest = await tx.specBook.findFirst({
          where: { bidId: bid.id },
          orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        });
        if (!latest) return;
        activeSpec = await tx.specBook.update({
          where: { id: latest.id },
          data: {
            revisionIndex: latest.revisionIndex ?? 0,
            effectiveState: latest.effectiveState ?? "EFFECTIVE",
            activeSlot: 1,
          },
        });
        result.specRevisions += 1;
      }

      const addenda = await tx.addendumUpload.findMany({
        where: { bidId: bid.id },
        orderBy: [
          { addendumNumber: "asc" },
          { uploadedAt: "desc" },
          { id: "desc" },
        ],
      });
      const activeByNumber = new Map<number, (typeof addenda)[number]>();
      for (const row of addenda) {
        if (!activeByNumber.has(row.addendumNumber)) {
          activeByNumber.set(row.addendumNumber, row);
        }
      }
      for (const row of activeByNumber.values()) {
        if (row.activeSlot === 1) continue;
        await tx.addendumUpload.update({
          where: { id: row.id },
          data: {
            revisionIndex: row.revisionIndex ?? 0,
            effectiveState: row.effectiveState ?? "EFFECTIVE",
            activeSlot: 1,
          },
        });
        result.addendumRevisions += 1;
      }

      const sections = await tx.specSection.findMany({
        where: { specBookId: activeSpec.id },
        orderBy: { id: "asc" },
      });
      for (const section of sections) {
        const exists = await tx.specSectionEvidenceRevision.findFirst({
          where: { bidId: bid.id, specSectionId: section.id },
          select: { id: true },
        });
        if (exists) continue;
        await appendSectionEvidenceTx(tx as unknown as Prisma.TransactionClient, {
          bidId: bid.id,
          specSectionId: section.id,
          rawText: section.rawText,
          pdfPath: section.pdfPath,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          pageCount: section.pageCount,
        });
        result.sectionEvidenceRevisions += 1;
      }

      const existingSet = await tx.specificationEffectiveSet.findFirst({
        where: { bidId: bid.id },
        select: { id: true },
      });
      if (existingSet) return;
      const orderedAddenda = [...activeByNumber.values()]
        .filter((row) => row.activeSlot === 1 || row.effectiveState !== "VOID")
        .sort((a, b) => a.addendumNumber - b.addendumNumber);
      const manifest = {
        schemaVersion: 1 as const,
        bidId: bid.id,
        versionNumber: 1,
        baseSpec: {
          id: activeSpec.id,
          revisionIndex: activeSpec.revisionIndex,
          sha256: activeSpec.sha256,
        },
        addenda: orderedAddenda.map((row, ordinal) => ({
          id: row.id,
          addendumNumber: row.addendumNumber,
          revisionIndex: row.revisionIndex,
          sha256: row.sha256,
          ordinal,
        })),
      };
      const manifestJson = JSON.stringify(manifest);
      await tx.specificationEffectiveSet.create({
        data: {
          bidId: bid.id,
          versionNumber: 1,
          baseSpecBookId: activeSpec.id,
          status: "PUBLISHED",
          publishedBy: "system-backfill",
          publishedAt: new Date(),
          manifestJson,
          manifestSha256: sha256Text(manifestJson),
          activeSlot: 1,
          addenda: {
            create: orderedAddenda.map((row, ordinal) => ({
              bidId: bid.id,
              addendumUploadId: row.id,
              ordinal,
            })),
          },
        },
      });
      result.effectiveSets += 1;
    });
  }
  return result;
}
