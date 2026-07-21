import {
  cancelMeetingIntelligence,
  meetingIntelligenceServiceStatus,
} from "@/lib/services/meetingIntelligence/service";
import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  let body: { artifactId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const artifactId = Number(body.artifactId);
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    return Response.json({ error: "Invalid artifactId" }, { status: 400 });
  }
  const result = await cancelMeetingIntelligence(
    ctx.bidId,
    ctx.meetingId,
    artifactId,
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
