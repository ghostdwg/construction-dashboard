import {
  meetingIntelligenceServiceStatus,
  reviewMeetingIntelligenceCandidate,
  type CandidateReviewInput,
} from "@/lib/services/meetingIntelligence/service";
import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; candidateId: string }> },
) {
  const { id, meetingId, candidateId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const parsedCandidateId = Number(candidateId);
  if (!Number.isInteger(parsedCandidateId) || parsedCandidateId <= 0) {
    return Response.json({ error: "Invalid candidateId" }, { status: 400 });
  }
  let body: CandidateReviewInput;
  try {
    body = (await request.json()) as CandidateReviewInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await reviewMeetingIntelligenceCandidate(
    ctx.bidId,
    ctx.meetingId,
    parsedCandidateId,
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
