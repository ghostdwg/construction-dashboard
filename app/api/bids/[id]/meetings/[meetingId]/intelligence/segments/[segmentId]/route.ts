import {
  correctMeetingIntelligenceSpeaker,
  meetingIntelligenceServiceStatus,
} from "@/lib/services/meetingIntelligence/service";
import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; segmentId: string }> },
) {
  const { id, meetingId, segmentId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const parsedSegmentId = Number(segmentId);
  if (!Number.isInteger(parsedSegmentId) || parsedSegmentId <= 0) {
    return Response.json({ error: "Invalid segmentId" }, { status: 400 });
  }
  let body: { speakerLabel?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await correctMeetingIntelligenceSpeaker(
    ctx.bidId,
    ctx.meetingId,
    parsedSegmentId,
    typeof body.speakerLabel === "string" ? body.speakerLabel : "",
    ctx.actor,
  );
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: meetingIntelligenceServiceStatus(result.error) },
    );
  }
  return Response.json({ ok: true, ...result.value });
}
