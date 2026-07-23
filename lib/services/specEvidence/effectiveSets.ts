import { prisma } from "@/lib/prisma";
import { sha256Text } from "./paragraphs";
import { emitSpecEvidenceAudit, writeSpecEvidenceAuditTx } from "./audit";

export type EffectiveManifest = {
  schemaVersion: 1;
  bidId: number;
  versionNumber: number;
  baseSpec: {
    id: number;
    revisionIndex: number | null;
    sha256: string | null;
  };
  addenda: Array<{
    id: number;
    addendumNumber: number;
    revisionIndex: number | null;
    sha256: string | null;
    ordinal: number;
  }>;
};

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function publishEffectiveSet(args: {
  bidId: number;
  baseSpecBookId: number;
  addendumUploadIds: number[];
  actorUserId: string;
}) {
  if (new Set(args.addendumUploadIds).size !== args.addendumUploadIds.length) {
    throw new Error("Each addendum revision may appear only once");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const committed = await prisma.$transaction(async (tx) => {
        const base = await tx.specBook.findFirst({
          where: {
            id: args.baseSpecBookId,
            bidId: args.bidId,
            effectiveState: { not: "VOID" },
          },
          select: { id: true, revisionIndex: true, sha256: true },
        });
        if (!base) throw new Error("Base Spec revision not found");

        const addenda =
          args.addendumUploadIds.length === 0
            ? []
            : await tx.addendumUpload.findMany({
                where: {
                  bidId: args.bidId,
                  id: { in: args.addendumUploadIds },
                  effectiveState: { not: "VOID" },
                },
                select: {
                  id: true,
                  addendumNumber: true,
                  revisionIndex: true,
                  sha256: true,
                },
              });
        const byId = new Map(addenda.map((row) => [row.id, row]));
        const ordered = args.addendumUploadIds.map((id, ordinal) => {
          const row = byId.get(id);
          if (!row) throw new Error("Addendum revision not found");
          return { ...row, ordinal };
        });

        const latest = await tx.specificationEffectiveSet.findFirst({
          where: { bidId: args.bidId },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        const active = await tx.specificationEffectiveSet.findFirst({
          where: { bidId: args.bidId, activeSlot: 1 },
          include: { addenda: { orderBy: { ordinal: "asc" } } },
        });
        if (
          active?.baseSpecBookId === base.id &&
          active.addenda.length === ordered.length &&
          active.addenda.every(
            (entry, index) => entry.addendumUploadId === ordered[index]?.id,
          )
        ) {
          return { created: active, audit: null };
        }
        const versionNumber = (latest?.versionNumber ?? 0) + 1;
        const manifest: EffectiveManifest = {
          schemaVersion: 1,
          bidId: args.bidId,
          versionNumber,
          baseSpec: base,
          addenda: ordered,
        };
        const manifestJson = JSON.stringify(manifest);

        if (active) {
          await tx.specificationEffectiveSet.update({
            where: { id: active.id },
            data: { status: "SUPERSEDED", activeSlot: null },
          });
        }
        const created = await tx.specificationEffectiveSet.create({
          data: {
            bidId: args.bidId,
            versionNumber,
            baseSpecBookId: base.id,
            status: "PUBLISHED",
            publishedBy: args.actorUserId,
            publishedAt: new Date(),
            supersedesId: active?.id ?? null,
            manifestJson,
            manifestSha256: sha256Text(manifestJson),
            activeSlot: 1,
            addenda: {
              create: ordered.map((row) => ({
                bidId: args.bidId,
                addendumUploadId: row.id,
                ordinal: row.ordinal,
              })),
            },
          },
          include: { addenda: { orderBy: { ordinal: "asc" } } },
        });
        const audit = await writeSpecEvidenceAuditTx(tx, {
          action: "publish_effective_set",
          subjectKind: "SPEC_EFFECTIVE_SET",
          subjectId: created.id,
          bidId: args.bidId,
          actorUserId: args.actorUserId,
          decision: "published",
          payload: {
            versionNumber,
            baseSpecBookId: base.id,
            addendumIds: ordered.map((row) => row.id),
            manifestSha256: created.manifestSha256,
          },
        });
        return { created, audit };
      });
      if (committed.audit) emitSpecEvidenceAudit(committed.audit);
      return committed.created;
    } catch (error) {
      if (isUniqueConflict(error) && attempt < 2) continue;
      if (isUniqueConflict(error)) {
        throw new Error("Effective set changed concurrently; refresh and retry");
      }
      throw error;
    }
  }
  throw new Error("Effective set could not be published");
}

export async function listEffectiveSets(bidId: number) {
  return prisma.specificationEffectiveSet.findMany({
    where: { bidId },
    orderBy: { versionNumber: "desc" },
    include: {
      baseSpecBook: {
        select: {
          id: true,
          fileName: true,
          revisionIndex: true,
          sha256: true,
          byteSize: true,
        },
      },
      addenda: {
        orderBy: { ordinal: "asc" },
        include: {
          addendumUpload: {
            select: {
              id: true,
              addendumNumber: true,
              fileName: true,
              revisionIndex: true,
              sha256: true,
              byteSize: true,
            },
          },
        },
      },
    },
  });
}
