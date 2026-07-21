import { completeMeetingIntelligenceJob } from "@/lib/services/meetingIntelligence/workerJobService";
import type { WorkerTranscriptSegment } from "@/lib/services/meetingIntelligence/heuristicExtractor";
import {
  meetingWorkerRouteContext,
  workerJson,
} from "@/lib/services/meetingIntelligence/workerRoute";

type CompletionBody = {
  leaseToken?: unknown;
  transcriptText?: unknown;
  segments?: unknown;
  sourceMediaChecksum?: unknown;
  resultChecksum?: unknown;
  toolVersions?: unknown;
  rawArtifact?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const ctx = meetingWorkerRouteContext(request, jobId);
  if (!ctx.ok) return ctx.response;
  const parsed = await workerJson<CompletionBody>(request);
  if (!parsed.ok) return parsed.response;
  let rawArtifactJson: string | null = null;
  if (parsed.body.rawArtifact != null) {
    try {
      rawArtifactJson = JSON.stringify(parsed.body.rawArtifact);
    } catch {
      return Response.json({ error: "rawArtifact must be JSON-serializable" }, { status: 400 });
    }
  }
  const result = await completeMeetingIntelligenceJob(ctx.jobId, {
    leaseToken: typeof parsed.body.leaseToken === "string" ? parsed.body.leaseToken : "",
    transcriptText: typeof parsed.body.transcriptText === "string" ? parsed.body.transcriptText : "",
    segments: (Array.isArray(parsed.body.segments) ? parsed.body.segments : []) as WorkerTranscriptSegment[],
    sourceMediaChecksum: typeof parsed.body.sourceMediaChecksum === "string" ? parsed.body.sourceMediaChecksum : "",
    resultChecksum: typeof parsed.body.resultChecksum === "string" ? parsed.body.resultChecksum : "",
    toolVersions: (parsed.body.toolVersions && typeof parsed.body.toolVersions === "object"
      ? parsed.body.toolVersions
      : {}) as never,
    rawArtifactJson,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true, ...result.value });
}
