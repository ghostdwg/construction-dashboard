import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  listEffectiveSets,
  publishEffectiveSet,
} from "@/lib/services/specEvidence/effectiveSets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bidId = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const [specRevisions, addendumRevisions, effectiveSets] = await Promise.all([
    prisma.specBook.findMany({
      where: { bidId },
      orderBy: [{ revisionIndex: "desc" }, { uploadedAt: "desc" }],
      select: {
        id: true,
        fileName: true,
        uploadedAt: true,
        status: true,
        revisionIndex: true,
        effectiveState: true,
        supersedesSpecBookId: true,
        sha256: true,
        byteSize: true,
        mimeType: true,
        activeSlot: true,
      },
    }),
    prisma.addendumUpload.findMany({
      where: { bidId },
      orderBy: [
        { addendumNumber: "asc" },
        { revisionIndex: "desc" },
        { uploadedAt: "desc" },
      ],
      select: {
        id: true,
        addendumNumber: true,
        addendumDate: true,
        fileName: true,
        uploadedAt: true,
        status: true,
        revisionIndex: true,
        effectiveState: true,
        supersedesAddendumId: true,
        sha256: true,
        byteSize: true,
        mimeType: true,
        activeSlot: true,
      },
    }),
    listEffectiveSets(bidId),
  ]);
  return Response.json({ specRevisions, addendumRevisions, effectiveSets });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bidId = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body as {
    baseSpecBookId?: unknown;
    addendumUploadIds?: unknown;
  };
  if (
    !Number.isInteger(input.baseSpecBookId) ||
    !Array.isArray(input.addendumUploadIds) ||
    !input.addendumUploadIds.every(Number.isInteger)
  ) {
    return Response.json(
      { error: "baseSpecBookId and ordered addendumUploadIds are required" },
      { status: 400 },
    );
  }
  try {
    const created = await publishEffectiveSet({
      bidId,
      baseSpecBookId: input.baseSpecBookId as number,
      addendumUploadIds: input.addendumUploadIds as number[],
      actorUserId: access.user.id,
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    const status = message.includes("not found") ? 404 : message.includes("concurrently") ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}
