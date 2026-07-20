import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore } from "@/lib/storage/blobStore";
import {
  classifyMeetingStoragePath,
  meetingMediaContentType,
  readMeetingStorageBuffer,
} from "@/lib/services/meetings/storagePath";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { audioFileName: true, audioStorageKey: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });
  if (!meeting.audioFileName) {
    return Response.json({ error: "Meeting media is unavailable" }, { status: 404 });
  }

  const mediaRef =
    meeting.audioStorageKey ??
    path.join(
      process.cwd(),
      "uploads",
      "meetings",
      String(mId),
      meeting.audioFileName,
    );
  let buffer: Buffer;
  let storedContentType: string | undefined;
  try {
    buffer = await readMeetingStorageBuffer(mediaRef, bidId, mId);
    const classified = classifyMeetingStoragePath(mediaRef, bidId, mId);
    if (classified.kind === "canonical" || classified.kind === "legacy-storage-root") {
      storedContentType = (await getBlobStore().stat(classified.canonicalKey))?.contentType;
    }
  } catch {
    return Response.json({ error: "Meeting media is unavailable" }, { status: 404 });
  }

  return new Response(new Uint8Array(buffer), {
    headers: privateDownloadHeaders({
      mimeType: meetingMediaContentType(meeting.audioFileName, storedContentType),
      fileName: meeting.audioFileName,
      byteSize: buffer.byteLength,
    }),
  });
}
