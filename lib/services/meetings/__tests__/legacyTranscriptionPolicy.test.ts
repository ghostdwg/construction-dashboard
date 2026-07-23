import { describe, expect, it } from "vitest";
import {
  LEGACY_TRANSCRIPTION_EXTERNAL_GATE,
  LEGACY_TRANSCRIPTION_GATE,
  legacyTranscriptionPolicy,
} from "../legacyTranscriptionPolicy";

describe("legacy transcription environment policy", () => {
  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "fails closed when the legacy gate is %s",
    (value) => {
      const policy = legacyTranscriptionPolicy({
        [LEGACY_TRANSCRIPTION_GATE]: value,
        [LEGACY_TRANSCRIPTION_EXTERNAL_GATE]: "true",
      });

      expect(policy.legacyEnabled).toBe(false);
    },
  );

  it("requires an independent exact-literal external permission", () => {
    expect(
      legacyTranscriptionPolicy({
        [LEGACY_TRANSCRIPTION_GATE]: "true",
        [LEGACY_TRANSCRIPTION_EXTERNAL_GATE]: "false",
      }),
    ).toEqual({ legacyEnabled: true, externalEnabled: false });
    expect(
      legacyTranscriptionPolicy({
        [LEGACY_TRANSCRIPTION_GATE]: "true",
        [LEGACY_TRANSCRIPTION_EXTERNAL_GATE]: "true",
      }),
    ).toEqual({ legacyEnabled: true, externalEnabled: true });
  });
});
