import { getMeetingIntelligenceJobMedia } from "@/lib/services/meetingIntelligence/workerJobService";
import { MEETING_WORKER_LEASE_HEADER } from "@/lib/services/meetingIntelligence/workerAuth";
import {
  meetingWorkerRouteContext,
  workerConflict,
} from "@/lib/services/meetingIntelligence/workerRoute";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const ctx = meetingWorkerRouteContext(request, jobId);
  if (!ctx.ok) return ctx.response;
  const result = await getMeetingIntelligenceJobMedia(
    ctx.jobId,
    request.headers.get(MEETING_WORKER_LEASE_HEADER) ?? "",
  );
  if (!result.ok) return workerConflict(result.reason);
  return new Response(new Uint8Array(result.value.data), {
    status: 200,
    headers: {
      "Content-Type": result.value.contentType,
      "Content-Length": String(result.value.data.length),
      "X-Content-SHA256": result.value.checksum,
      "Cache-Control": "private, no-store",
    },
  });
}
