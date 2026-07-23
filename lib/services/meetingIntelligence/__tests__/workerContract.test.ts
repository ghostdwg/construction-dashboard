import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorkerTranscriptSegment } from "../heuristicExtractor";
import {
  computeMeetingIntelligenceResultChecksum,
  type WorkerToolVersions,
} from "../workerContract";

type ChecksumFixture = {
  name: string;
  input: {
    transcriptText: string;
    segments: WorkerTranscriptSegment[];
    toolVersions: WorkerToolVersions;
    rawArtifact: unknown;
  };
  expectedChecksum: string;
};

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/worker-checksum-contract.json", import.meta.url), "utf8"),
) as ChecksumFixture[];

describe("Meeting Intelligence worker checksum contract", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const rawArtifactJson = fixture.input.rawArtifact == null
        ? null
        : JSON.stringify(fixture.input.rawArtifact);
      expect(
        computeMeetingIntelligenceResultChecksum({
          transcriptText: fixture.input.transcriptText,
          segments: fixture.input.segments,
          toolVersions: fixture.input.toolVersions,
          rawArtifactJson,
        }),
      ).toBe(fixture.expectedChecksum);
    });
  }
});
