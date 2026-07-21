import { claimNextMeetingIntelligenceJob } from "@/lib/services/meetingIntelligence/workerJobService";
import {
  meetingWorkerRouteContext,
  workerJson,
} from "@/lib/services/meetingIntelligence/workerRoute";

export async function POST(request: Request) {
  const ctx = meetingWorkerRouteContext(request);
  if (!ctx.ok) return ctx.response;
  const parsed = await workerJson<{ workerId?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const result = await claimNextMeetingIntelligenceJob(
    typeof parsed.body.workerId === "string" ? parsed.body.workerId : "",
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, ...result.value });
}
