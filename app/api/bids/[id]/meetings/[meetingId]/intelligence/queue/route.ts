import {
  meetingIntelligenceServiceStatus,
  queueMeetingIntelligence,
} from "@/lib/services/meetingIntelligence/service";
import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const result = await queueMeetingIntelligence(
    ctx.bidId,
    ctx.meetingId,
    ctx.actor,
  );
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: meetingIntelligenceServiceStatus(result.error) },
    );
  }
  return Response.json({ ok: true, ...result.value }, { status: result.value.created ? 201 : 200 });
}
