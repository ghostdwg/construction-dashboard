import { failMeetingIntelligenceJob } from "@/lib/services/meetingIntelligence/workerJobService";
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
  const parsed = await workerJson<{
    leaseToken?: unknown;
    errorCode?: unknown;
    errorMessage?: unknown;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const result = await failMeetingIntelligenceJob(
    ctx.jobId,
    typeof parsed.body.leaseToken === "string" ? parsed.body.leaseToken : "",
    typeof parsed.body.errorCode === "string" ? parsed.body.errorCode : "WORKER_FAILURE",
    typeof parsed.body.errorMessage === "string" ? parsed.body.errorMessage : "Private worker reported failure",
  );
  if (!result.ok) return workerConflict(result.reason);
  return Response.json(result);
}
