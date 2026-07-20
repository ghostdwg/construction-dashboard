import {
  buildAuditEnvelope,
  emitAuditEnvelopeStdout,
  persistAuditEnvelope,
  type AuditEventWriter,
} from "@/lib/observability/audit";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import type { Actor } from "./index";

export async function writeConsultantAuditTx(
  tx: AuditEventWriter,
  args: {
    action: string;
    bidId: number;
    subjectId: number;
    actor: Actor | null;
    decision: string;
    payload: Record<string, unknown>;
  },
): Promise<AuditEnvelope> {
  const envelope = buildAuditEnvelope({
    category: "consultant_report",
    action: args.action,
    severity: "NOTICE",
    decision: args.decision,
    subject: { kind: "ConsultantObservation", id: String(args.subjectId) },
    actor: {
      kind: args.actor ? "operator" : "anonymous",
      userId: args.actor?.id ?? null,
      email: args.actor?.email ?? null,
    },
    payload: { bidId: args.bidId, ...args.payload },
  });
  await persistAuditEnvelope(tx, envelope);
  return envelope;
}

export function emitConsultantAuditPostCommit(
  envelope: AuditEnvelope | null | undefined,
): void {
  if (envelope) emitAuditEnvelopeStdout(envelope);
}
