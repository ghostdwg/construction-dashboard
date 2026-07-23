import {
  buildAuditEnvelope,
  emitAuditEnvelopeStdout,
  persistAuditEnvelope,
  type AuditEventWriter,
} from "@/lib/observability/audit";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";

export async function writeSpecEvidenceAuditTx(
  tx: AuditEventWriter,
  args: {
    action: string;
    subjectKind: string;
    subjectId: string | number;
    bidId: number;
    actorUserId: string;
    decision?: string;
    payload?: Record<string, unknown>;
  },
): Promise<AuditEnvelope> {
  const envelope = buildAuditEnvelope({
    category: "spec_requirement",
    action: args.action,
    severity: "NOTICE",
    decision: args.decision ?? "committed",
    subject: { kind: args.subjectKind, id: String(args.subjectId) },
    actor: { kind: "operator", userId: args.actorUserId },
    payload: { bidId: args.bidId, ...args.payload },
  });
  await persistAuditEnvelope(tx, envelope);
  return envelope;
}

export function emitSpecEvidenceAudit(envelope: AuditEnvelope): void {
  emitAuditEnvelopeStdout(envelope);
}
