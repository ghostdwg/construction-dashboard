export const LEGACY_TRANSCRIPTION_GATE = "LEGACY_TRANSCRIPTION_ENABLED";
export const LEGACY_TRANSCRIPTION_EXTERNAL_GATE =
  "LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED";

export const LEGACY_TRANSCRIPTION_DISABLED_CODE =
  "LEGACY_TRANSCRIPTION_DISABLED";
export const LEGACY_TRANSCRIPTION_DISABLED_MESSAGE =
  "Legacy transcription processing is disabled.";

type Environment = Record<string, string | undefined>;

// Feature permissions use exact, lower-case literals throughout the repo.
// Missing, empty, mixed-case, and otherwise malformed values are all denied.
export function legacyTranscriptionPolicy(environment: Environment = process.env) {
  return {
    legacyEnabled: environment[LEGACY_TRANSCRIPTION_GATE] === "true",
    externalEnabled:
      environment[LEGACY_TRANSCRIPTION_EXTERNAL_GATE] === "true",
  } as const;
}

export function isLegacyTranscriptionEnabled(
  environment: Environment = process.env,
) {
  return legacyTranscriptionPolicy(environment).legacyEnabled;
}

export function legacyTranscriptionDisabledResponse() {
  return Response.json(
    {
      ok: false,
      code: LEGACY_TRANSCRIPTION_DISABLED_CODE,
      state: "disabled",
      message: LEGACY_TRANSCRIPTION_DISABLED_MESSAGE,
    },
    { status: 503 },
  );
}
