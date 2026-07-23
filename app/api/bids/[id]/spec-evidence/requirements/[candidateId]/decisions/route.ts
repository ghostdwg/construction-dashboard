import { requireBidAccess } from "@/lib/auth-helpers";
import {
  appendSpecRequirementDecision,
  SPEC_DECISIONS,
  type SpecDecision,
} from "@/lib/services/specEvidence/decisions";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; candidateId: string }>;
  },
) {
  const resolved = await params;
  const bidId = Number.parseInt(resolved.id, 10);
  const candidateId = Number.parseInt(resolved.candidateId, 10);
  if (!Number.isInteger(bidId) || !Number.isInteger(candidateId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: { decision?: unknown; reason?: unknown; correctionOfId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    typeof body.decision !== "string" ||
    !SPEC_DECISIONS.includes(body.decision as SpecDecision) ||
    (body.reason !== undefined && typeof body.reason !== "string") ||
    (body.correctionOfId !== undefined && !Number.isInteger(body.correctionOfId))
  ) {
    return Response.json({ error: "Invalid decision payload" }, { status: 400 });
  }
  try {
    const decision = await appendSpecRequirementDecision({
      bidId,
      candidateId,
      decision: body.decision as SpecDecision,
      reason: (body.reason as string | undefined) ?? null,
      correctionOfId: (body.correctionOfId as number | undefined) ?? null,
      actorUserId: access.user.id,
    });
    return Response.json(decision, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decision failed";
    return Response.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400 },
    );
  }
}
