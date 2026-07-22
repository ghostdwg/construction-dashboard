import {
  batchReviewMeetingIntelligenceCandidates,
  meetingIntelligenceServiceStatus,
  type CandidateBatchReviewInput,
} from "@/lib/services/meetingIntelligence/service";
import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";

type BatchBody = CandidateBatchReviewInput & { artifactId?: number };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  let body: BatchBody;
  try {
    body = (await request.json()) as BatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Number.isInteger(body.artifactId) || Number(body.artifactId) <= 0) {
    return Response.json({ error: "Invalid artifactId" }, { status: 400 });
  }
  const result = await batchReviewMeetingIntelligenceCandidates(
    ctx.bidId,
    ctx.meetingId,
    Number(body.artifactId),
    body,
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
