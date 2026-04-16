// POST /api/bids/[id]/meetings/[meetingId]/upload
//
// Accepts a multipart audio file, proxies it to the sidecar for
// AssemblyAI upload + job submission. On success, stores the
// transcriptionJobId on the meeting and advances status to TRANSCRIBING.
//
// If AssemblyAI is not configured (sidecar returns 400), the route stores
// the audio filename and sets status to PENDING so the user can paste the
// transcript manually.

import { prisma } from "@/lib/prisma";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true, status: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  if (!audioFile)
    return Response.json({ error: "audio file is required" }, { status: 400 });

  // Mark as uploading
  await prisma.meeting.update({
    where: { id: mId },
    data: {
      status: "UPLOADING",
      audioFileName: audioFile.name,
      uploadedAt: new Date(),
    },
  });

  // Proxy to sidecar
  const sidecarForm = new FormData();
  sidecarForm.append("audio", audioFile);

  const headers: Record<string, string> = {};
  if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

  try {
    const res = await fetch(`${SIDECAR_URL}/meetings/transcribe`, {
      method: "POST",
      headers,
      body: sidecarForm,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Sidecar error" }));

      if (res.status === 400 && String(err.detail).includes("not configured")) {
        // AssemblyAI not set up — remain PENDING for manual transcript entry
        await prisma.meeting.update({
          where: { id: mId },
          data: { status: "PENDING" },
        });
        return Response.json({
          ok: false,
          manual: true,
          message: "AssemblyAI not configured. Enter transcript manually.",
        });
      }

      await prisma.meeting.update({
        where: { id: mId },
        data: { status: "FAILED" },
      });
      return Response.json(
        { error: err.detail ?? "Sidecar error" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { transcriptionJobId: string; source: string };

    await prisma.meeting.update({
      where: { id: mId },
      data: {
        status: "TRANSCRIBING",
        transcriptionJobId: data.transcriptionJobId,
        transcriptionSource: data.source,
      },
    });

    return Response.json({
      ok: true,
      transcriptionJobId: data.transcriptionJobId,
      source: data.source,
    });
  } catch (err) {
    await prisma.meeting.update({
      where: { id: mId },
      data: { status: "FAILED" },
    });
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
