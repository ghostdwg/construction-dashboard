import {
  buildAuditEnvelope,
  emitAuditEnvelopeStdout,
  persistAuditEnvelope,
  type AuditEventWriter,
} from "@/lib/observability/audit";
import type { AuditCategory, AuditEnvelope } from "@/lib/observability/taxonomy";

export type OperationsActor = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
} | null;

export async function writeOperationsAuditTx(
  tx: AuditEventWriter,
  args: {
    category?: AuditCategory;
    action: string;
    decision: string;
    subjectKind: "FieldReport" | "TrackedItem";
    subjectId: number;
    actor: OperationsActor;
    /** IDs, counts, types and field names only; never domain bodies/text. */
    payload: Record<string, unknown>;
  },
): Promise<AuditEnvelope> {
  const envelope = buildAuditEnvelope({
    category: args.category ?? "register_action",
    action: args.action,
    severity: "NOTICE",
    decision: args.decision,
    subject: { kind: args.subjectKind, id: String(args.subjectId) },
    actor: {
      kind: "operator",
      userId: args.actor?.id ?? null,
      email: args.actor?.email ?? null,
    },
    payload: args.payload,
  });
  await persistAuditEnvelope(tx, envelope);
  return envelope;
}

export function emitOperationsAuditPostCommit(envelope: AuditEnvelope | null | undefined): void {
  if (envelope) emitAuditEnvelopeStdout(envelope);
}
