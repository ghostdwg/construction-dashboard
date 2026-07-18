import {
  buildAuditEnvelope,
  emitAuditEnvelopeStdout,
  persistAuditEnvelope,
  type AuditEventWriter,
} from "@/lib/observability/audit";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import { actorLabel, type Actor } from "./types";

export async function writeTradeAuditTx(
  tx: AuditEventWriter,
  args: {
    action: string;
    subjectKind: string;
    subjectId: string | number;
    bidId: number;
    actor: Actor | null;
    decision?: string;
    payload?: Record<string, unknown>;
  }
): Promise<AuditEnvelope> {
  const envelope = buildAuditEnvelope({
    category: "register_action",
    action: args.action,
    severity: "NOTICE",
    decision: args.decision ?? "committed",
    subject: { kind: args.subjectKind, id: String(args.subjectId) },
    actor: {
      kind: args.actor ? "operator" : "anonymous",
      userId: args.actor?.id ?? null,
      email: args.actor?.email ?? null,
    },
    payload: { bidId: args.bidId, actorLabel: actorLabel(args.actor), ...args.payload },
  });
  await persistAuditEnvelope(tx, envelope);
  return envelope;
}

export function emitTradeAudits(envelopes: AuditEnvelope | AuditEnvelope[]): void {
  for (const envelope of Array.isArray(envelopes) ? envelopes : [envelopes]) {
    emitAuditEnvelopeStdout(envelope);
  }
}
