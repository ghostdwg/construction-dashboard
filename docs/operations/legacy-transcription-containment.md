# Legacy transcription containment

The legacy `Meeting.status` / `Meeting.transcript` pipeline is disabled unless
both the Next.js app and the Python sidecar receive this exact setting:

```text
LEGACY_TRANSCRIPTION_ENABLED=true
```

Missing, empty, mixed-case, and malformed values are disabled. The app also
validates the setting as `true` or `false` at startup. Keep the value identical
in both processes; either process can independently deny a request.

AssemblyAI is a separate break-glass path. It additionally requires this exact
setting in the sidecar process:

```text
LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED=true
```

The external permission does not enable the legacy pipeline by itself. The app
rejects a configuration that grants external permission while the primary
legacy gate is off. An AssemblyAI credential, by itself, never grants provider
permission.

## Operator states

| Legacy gate | External gate | WhisperX configured | AssemblyAI credential configured | Result |
|---|---|---|---|---|
| unset, invalid, or `false` | any | any | any | Legacy upload, source mapping, and status processing return a non-secret `LEGACY_TRANSCRIPTION_DISABLED` state. No provider is called. |
| `true` | unset, invalid, or `false` | yes | any | WhisperX is the only permitted provider. A WhisperX failure returns an error and never falls back externally. |
| `true` | unset, invalid, or `false` | no | any | Processing fails closed because no permitted local provider is configured. |
| `true` | `true` | yes | any | WhisperX is selected. A WhisperX failure still never falls back externally. |
| `true` | `true` | no | yes | AssemblyAI may be selected as the explicit break-glass provider. |
| `true` | `true` | no | no | Processing fails closed because no permitted provider is configured. |

The external gate also applies when polling existing AssemblyAI job IDs,
including unprefixed legacy IDs. Disabling processing does not delete or alter
stored media, transcript, or status data. Historical meeting-detail reads and
manual transcript entry remain available, and the separate Meeting
Intelligence v2 worker queue does not read these gates.

Environment changes require the affected app and sidecar processes to be
restarted through the normal operator-controlled release procedure. Do not put
real credentials in this document or any checked-in environment example.
