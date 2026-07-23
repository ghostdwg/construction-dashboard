import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

type CandidateType =
  | "SUBMITTAL"
  | "RFI"
  | "CLOSEOUT"
  | "WARRANTY"
  | "TRAINING"
  | "TESTING"
  | "INSPECTION"
  | "ACTION_ITEM"
  | "OTHER";

const ARRAY_TYPES: Array<{ keys: string[]; type: CandidateType }> = [
  { keys: ["submittals"], type: "SUBMITTAL" },
  { keys: ["rfi", "rfis", "clarifications"], type: "RFI" },
  { keys: ["closeout"], type: "CLOSEOUT" },
  { keys: ["warranty", "warranties"], type: "WARRANTY" },
  { keys: ["training"], type: "TRAINING" },
  { keys: ["testing", "tests"], type: "TESTING" },
  { keys: ["inspection", "inspections"], type: "INSPECTION" },
  { keys: ["action_items", "actions"], type: "ACTION_ITEM" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function itemText(item: unknown): { title: string | null; text: string } | null {
  if (typeof item === "string" && item.trim()) return { title: null, text: item.trim() };
  const record = asRecord(item);
  if (!record) return null;
  const title = firstString(record, ["title", "topic", "activity", "item", "type"]);
  const text =
    firstString(record, [
      "requirement",
      "description",
      "scope",
      "text",
      "notes",
      "product",
      "activity",
      "topic",
      "title",
    ]) ?? JSON.stringify(record);
  return text ? { title, text } : null;
}

function stableGroupId(parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

export async function extractDraftRequirementCandidates(args: {
  bidId: number;
  effectiveSetId: number;
}) {
  const effectiveSet = await prisma.specificationEffectiveSet.findFirst({
    where: { id: args.effectiveSetId, bidId: args.bidId, status: "PUBLISHED" },
    select: {
      id: true,
      versionNumber: true,
      baseSpecBookId: true,
    },
  });
  if (!effectiveSet) throw new Error("Published effective set not found");

  const sections = await prisma.specSection.findMany({
    where: { specBookId: effectiveSet.baseSpecBookId },
    orderBy: [{ csiNumber: "asc" }, { id: "asc" }],
    select: {
      id: true,
      csiNumber: true,
      csiTitle: true,
      aiExtractions: true,
      evidenceRevisions: {
        orderBy: { revisionIndex: "desc" },
        take: 1,
        include: { paragraphs: { orderBy: { ordinal: "asc" } } },
      },
    },
  });

  let created = 0;
  let unchanged = 0;
  for (const section of sections) {
    if (!section.aiExtractions || section.evidenceRevisions.length === 0) continue;
    let extraction: Record<string, unknown>;
    try {
      extraction = asRecord(JSON.parse(section.aiExtractions)) ?? {};
    } catch {
      continue;
    }
    const evidence = section.evidenceRevisions[0];
    if (evidence.paragraphs.length === 0) continue;

    for (const mapping of ARRAY_TYPES) {
      const values = mapping.keys
        .map((key) => extraction[key])
        .find((value): value is unknown[] => Array.isArray(value));
      if (!values) continue;
      for (let index = 0; index < values.length; index += 1) {
        const normalized = itemText(values[index]);
        if (!normalized) continue;
        const paragraph =
          evidence.paragraphs.find((row) =>
            row.text.toLowerCase().includes(normalized.text.slice(0, 80).toLowerCase()),
          ) ?? evidence.paragraphs[0];
        const groupId = stableGroupId([
          args.bidId,
          effectiveSet.id,
          section.id,
          mapping.type,
          index,
        ]);
        const prior = await prisma.specRequirementCandidate.findFirst({
          where: { candidateGroupId: groupId },
          orderBy: { revisionIndex: "desc" },
          select: { id: true, revisionIndex: true, draftText: true },
        });
        if (prior?.draftText === normalized.text) {
          unchanged += 1;
          continue;
        }
        const sourceLocator = `Section ${section.csiNumber}, ${paragraph.paragraphLabel}, Effective Set ${effectiveSet.versionNumber}`;
        await prisma.$transaction(async (tx) => {
          const citation = await tx.specCitation.create({
            data: {
              bidId: args.bidId,
              effectiveSetId: effectiveSet.id,
              sectionEvidenceRevisionId: evidence.id,
              specParagraphId: paragraph.id,
              sourceLocator,
              evidenceExcerpt: paragraph.text.slice(0, 2000),
              textSha256: paragraph.textSha256,
              extractionMethod: "stored_analysis",
              extractorVersion: "spec-evidence-v1",
            },
          });
          await tx.specRequirementCandidate.create({
            data: {
              bidId: args.bidId,
              effectiveSetId: effectiveSet.id,
              citationId: citation.id,
              candidateGroupId: groupId,
              revisionIndex: (prior?.revisionIndex ?? 0) + 1,
              supersedesCandidateId: prior?.id ?? null,
              requirementType: mapping.type,
              draftTitle:
                normalized.title ??
                `${mapping.type.replaceAll("_", " ")} — ${section.csiNumber}`,
              draftText: normalized.text,
              evidenceExcerpt: paragraph.text.slice(0, 2000),
              sourceLocator,
              extractionMethod: "stored_analysis",
              extractorVersion: "spec-evidence-v1",
              reviewState: "DRAFT",
            },
          });
        });
        created += 1;
      }
    }
  }
  return { created, unchanged };
}

export async function listRequirementCandidates(bidId: number) {
  return prisma.specRequirementCandidate.findMany({
    where: { bidId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      effectiveSet: { select: { versionNumber: true, status: true } },
      citation: {
        include: {
          specParagraph: {
            select: {
              paragraphLabel: true,
              pageNumber: true,
              pageEnd: true,
            },
          },
          sectionEvidenceRevision: {
            include: {
              specSection: {
                select: { csiNumber: true, csiTitle: true },
              },
            },
          },
        },
      },
      decisions: { orderBy: { decidedAt: "asc" } },
    },
  });
}
