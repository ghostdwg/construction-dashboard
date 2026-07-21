import { reportMeetingIntelligenceProgress } from "@/lib/services/meetingIntelligence/workerJobService";
import type { MeetingIntelligenceProgressStage } from "@/lib/services/meetingIntelligence/types";
import {
  meetingWorkerRouteContext,
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
    stage?: unknown;
    percent?: unknown;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const result = await reportMeetingIntelligenceProgress(
    ctx.jobId,
    typeof parsed.body.leaseToken === "string" ? parsed.body.leaseToken : "",
    String(parsed.body.stage ?? "") as MeetingIntelligenceProgressStage,
    Number(parsed.body.percent),
  );
  if (!result.ok) {
    const status = result.reason.startsWith("invalid_") ? 400 : 409;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  return Response.json(result);
}
