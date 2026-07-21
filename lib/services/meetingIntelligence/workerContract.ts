import { createHash } from "node:crypto";
import type { WorkerTranscriptSegment } from "./heuristicExtractor";

export type WorkerToolVersions = {
  transcriptionTool: string;
  transcriptionModel: string;
  transcriptionVersion: string;
  diarizationTool?: string | null;
  diarizationModel?: string | null;
  diarizationVersion?: string | null;
};

/** Pure result identity shared by the application and local stub client. */
export function computeMeetingIntelligenceResultChecksum(input: {
  transcriptText: string;
  segments: WorkerTranscriptSegment[];
  toolVersions: WorkerToolVersions;
  rawArtifactJson?: string | null;
}): string {
  const canonicalSegments = input.segments.map((segment, segmentIndex) => ({
    segmentIndex,
    startSec: segment.startSec ?? null,
    endSec: segment.endSec ?? null,
    text: segment.text,
    speakerLabel: segment.speakerLabel,
    confidence: segment.confidence ?? null,
  }));
  const canonicalToolVersions = {
    transcriptionTool: input.toolVersions.transcriptionTool,
    transcriptionModel: input.toolVersions.transcriptionModel,
    transcriptionVersion: input.toolVersions.transcriptionVersion,
    diarizationTool: input.toolVersions.diarizationTool ?? null,
    diarizationModel: input.toolVersions.diarizationModel ?? null,
    diarizationVersion: input.toolVersions.diarizationVersion ?? null,
  };
  return createHash("sha256")
    .update(
      JSON.stringify({
        transcriptText: input.transcriptText,
        segments: canonicalSegments,
        toolVersions: canonicalToolVersions,
        rawArtifactJson: input.rawArtifactJson ?? null,
      }),
    )
    .digest("hex");
}
