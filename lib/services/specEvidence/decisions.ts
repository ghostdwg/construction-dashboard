import { prisma } from "@/lib/prisma";
import { emitSpecEvidenceAudit, writeSpecEvidenceAuditTx } from "./audit";

export const SPEC_DECISIONS = [
  "ACCEPT",
  "REJECT",
  "RETURN_FOR_EDIT",
  "VOID",
] as const;
export type SpecDecision = (typeof SPEC_DECISIONS)[number];

const STATE_BY_DECISION: Record<SpecDecision, string> = {
  ACCEPT: "ACCEPTED",
  REJECT: "REJECTED",
  RETURN_FOR_EDIT: "RETURNED",
  VOID: "VOID",
};

export async function appendSpecRequirementDecision(args: {
  bidId: number;
  candidateId: number;
  decision: SpecDecision;
  reason?: string | null;
  correctionOfId?: number | null;
  actorUserId: string;
}) {
  const reason = args.reason?.trim() || null;
  if (reason && reason.length > 2000) {
    throw new Error("Decision reason must be 2000 characters or fewer");
  }

  const committed = await prisma.$transaction(async (tx) => {
    const candidate = await tx.specRequirementCandidate.findFirst({
      where: { id: args.candidateId, bidId: args.bidId },
      select: { id: true, effectiveSetId: true },
    });
    if (!candidate) throw new Error("Requirement candidate not found");

    if (args.correctionOfId) {
      const corrected = await tx.specRequirementDecision.findFirst({
        where: {
          id: args.correctionOfId,
          bidId: args.bidId,
          candidateId: args.candidateId,
        },
        select: { id: true },
      });
      if (!corrected) throw new Error("Corrected decision not found");
    }

    const decision = await tx.specRequirementDecision.create({
      data: {
        candidateId: args.candidateId,
        bidId: args.bidId,
        decision: args.decision,
        reason,
        decidedBy: args.actorUserId,
        correctionOfId: args.correctionOfId ?? null,
      },
    });
    await tx.specRequirementCandidate.update({
      where: { id: candidate.id },
      data: { reviewState: STATE_BY_DECISION[args.decision] },
    });
    const audit = await writeSpecEvidenceAuditTx(tx, {
      action: "append_candidate_decision",
      subjectKind: "SPEC_REQUIREMENT_CANDIDATE",
      subjectId: candidate.id,
      bidId: args.bidId,
      actorUserId: args.actorUserId,
      decision: args.decision.toLowerCase(),
      payload: {
        decisionId: decision.id,
        effectiveSetId: candidate.effectiveSetId,
        correctionOfId: decision.correctionOfId,
        hasReason: reason !== null,
      },
    });
    return { decision, audit };
  });
  emitSpecEvidenceAudit(committed.audit);
  return committed.decision;
}
