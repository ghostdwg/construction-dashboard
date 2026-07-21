import { heartbeatMeetingIntelligenceJob } from "@/lib/services/meetingIntelligence/workerJobService";
import {
  meetingWorkerRouteContext,
  workerConflict,
  workerJson,
} from "@/lib/services/meetingIntelligence/workerRoute";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const ctx = meetingWorkerRouteContext(request, jobId);
  if (!ctx.ok) return ctx.response;
  const parsed = await workerJson<{ leaseToken?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const result = await heartbeatMeetingIntelligenceJob(
    ctx.jobId,
    typeof parsed.body.leaseToken === "string" ? parsed.body.leaseToken : "",
  );
  if (!result.ok) return workerConflict(result.reason);
  return Response.json(result);
}
