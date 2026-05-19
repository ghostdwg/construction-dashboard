// PATCH /api/market-intelligence/workspace/alerts/[id]
//   body: { action: "acknowledge" | "dismiss" | "escalate" | "suppress" }
//
// Auth required. Returns { ok, error? }.

import { auth } from "@/lib/auth";
import { reviewAlertEvent } from "@/lib/services/operatorWorkspace";

async function requireUser() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string } | undefined;
  if (!user) return { ok: false as const, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true as const, actor: { userId: user.id ?? null, email: user.email ?? null } };
}

const ACTION_TO_STATUS: Record<string, "ACKNOWLEDGED" | "DISMISSED" | "ESCALATED" | "SUPPRESSED"> = {
  acknowledge: "ACKNOWLEDGED",
  dismiss: "DISMISSED",
  escalate: "ESCALATED",
  suppress: "SUPPRESSED",
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireUser();
  if (!a.ok) return a.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const status = body.action ? ACTION_TO_STATUS[body.action] : undefined;
  if (!status) {
    return Response.json(
      { ok: false, error: "action must be one of: acknowledge | dismiss | escalate | suppress" },
      { status: 400 }
    );
  }

  const result = await reviewAlertEvent({
    alertId: id,
    newStatus: status,
    actor: a.actor,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
