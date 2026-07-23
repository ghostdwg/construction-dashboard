import type { Prisma } from "@prisma/client";
import { parseDeterministicParagraphs, sha256Text } from "./paragraphs";

type SectionEvidenceInput = {
  bidId: number;
  specSectionId: number;
  rawText: string;
  pdfPath?: string | null;
  pdfSha256?: string | null;
  pdfByteSize?: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  pageCount?: number | null;
};

export async function appendSectionEvidenceTx(
  tx: Prisma.TransactionClient,
  input: SectionEvidenceInput,
) {
  const prior = await tx.specSectionEvidenceRevision.findFirst({
    where: { bidId: input.bidId, specSectionId: input.specSectionId },
    orderBy: { revisionIndex: "desc" },
    select: {
      id: true,
      revisionIndex: true,
      textSha256: true,
      pdfPath: true,
      pdfSha256: true,
      pdfByteSize: true,
      pageStart: true,
      pageEnd: true,
      pageCount: true,
    },
  });
  const textSha256 = sha256Text(input.rawText);
  if (
    prior?.textSha256 === textSha256 &&
    prior.pdfPath === (input.pdfPath ?? null) &&
    prior.pdfSha256 === (input.pdfSha256 ?? null) &&
    prior.pdfByteSize === (input.pdfByteSize ?? null) &&
    prior.pageStart === (input.pageStart ?? null) &&
    prior.pageEnd === (input.pageEnd ?? null) &&
    prior.pageCount === (input.pageCount ?? null)
  ) {
    return tx.specSectionEvidenceRevision.findUniqueOrThrow({
      where: { id: prior.id },
    });
  }

  const revision = await tx.specSectionEvidenceRevision.create({
    data: {
      bidId: input.bidId,
      specSectionId: input.specSectionId,
      revisionIndex: (prior?.revisionIndex ?? 0) + 1,
      supersedesRevisionId: prior?.id ?? null,
      rawText: input.rawText,
      textSha256,
      pdfPath: input.pdfPath ?? null,
      pdfSha256: input.pdfSha256 ?? null,
      pdfByteSize: input.pdfByteSize ?? null,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      pageCount: input.pageCount ?? null,
    },
  });

  const paragraphs = parseDeterministicParagraphs(
    input.rawText,
    input.pageStart ?? null,
    input.pageEnd ?? null,
  );
  if (paragraphs.length > 0) {
    await tx.specParagraph.createMany({
      data: paragraphs.map((paragraph) => ({
        bidId: input.bidId,
        sectionEvidenceRevisionId: revision.id,
        ...paragraph,
      })),
    });
  }
  return revision;
}
