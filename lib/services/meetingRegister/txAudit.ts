// lib/services/meetingRegister/txAudit.ts
//
// R2 remediation — fail-closed, in-transaction audit for the Meeting
// Register domain (GroundWorX audit policy):
//   • the AuditEvent row is written INSIDE the same database transaction as
//     the mutation it records — if the audit write fails, the whole
//     mutation rolls back (audit never fails open);
//   • the stdout/Loki fan-out happens only AFTER commit, so external
//     telemetry never reports a mutation that did not occur;
//   • payloads carry ids/counts/labels only — detailed text lives in the
//     domain revision/correction rows, never in generic audit metadata.

import {
  buildAuditEnvelope,
  emitAuditEnvelopeStdout,
  persistAuditEnvelope,
  type AuditEventWriter,
} from "@/lib/observability/audit";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import { actorLabel, type Actor } from "./types";

export type RegisterAuditArgs = {
  action: string;
  decision: string;
  subjectKind:
    | "MeetingRegisterEntry"
    | "MeetingTranscriptCorrection"
    | "MeetingExtractionRun"
    | "MeetingMinutesRevision"
    | "Meeting"
    | "MeetingParticipant";
  subjectId: number;
  actor: Actor | null;
  /** ids/counts/labels only — never transcript or entry text */
  payload: Record<string, unknown>;
};

/**
 * Write the mandatory AuditEvent row inside the caller's transaction.
 * THROWS on failure so the caller's transaction rolls back — no mutation
 * may exist without its audit record. Returns the envelope for post-commit
 * stdout emission via emitRegisterAuditPostCommit.
 */
export async function writeRegisterAuditTx(
  tx: AuditEventWriter,
  args: RegisterAuditArgs
): Promise<AuditEnvelope> {
  const envelope = buildAuditEnvelope({
    category: "register_action",
    action: args.action,
    severity: "NOTICE",
    decision: args.decision,
    subject: { kind: args.subjectKind, id: String(args.subjectId) },
    actor: {
      kind: "operator",
      userId: args.actor?.id ?? null,
      email: args.actor?.email ?? null,
    },
    payload: { actorLabel: actorLabel(args.actor), ...args.payload },
  });
  await persistAuditEnvelope(tx, envelope);
  return envelope;
}

/** Post-commit telemetry fan-out for envelopes written via writeRegisterAuditTx. */
export function emitRegisterAuditPostCommit(
  envelope: AuditEnvelope | null | undefined
): void {
  if (envelope) emitAuditEnvelopeStdout(envelope);
}
