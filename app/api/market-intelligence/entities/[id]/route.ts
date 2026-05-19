// PATCH /api/market-intelligence/entities/[id]
//   body: { action: "verify" | "reject" | "unreject"; reason?: string }
//
// Admin-only. Returns { ok: boolean, error?: string, ... }.

import { auth } from "@/lib/auth";
import { verifyEntity, rejectEntity, unrejectEntity } from "@/lib/services/entityGovernance";
import type { GovernanceActorContext } from "@/lib/services/entityGovernance/types";

async function requireAdmin(): Promise<
  | { ok: true; actor: GovernanceActorContext }
  | { ok: false; response: Response }
> {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  if (!user) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { ok: false, response: Response.json({ error: "admin required" }, { status: 403 }) };
  }
  return {
    ok: true,
    actor: { userId: user.id ?? null, email: user.email ?? null },
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth_ = await requireAdmin();
  if (!auth_.ok) return auth_.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    reason?: string;
  };

  switch (body.action) {
    case "verify": {
      const r = await verifyEntity(id, auth_.actor);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    case "reject": {
      const r = await rejectEntity(id, auth_.actor, body.reason);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    case "unreject": {
      const r = await unrejectEntity(id, auth_.actor);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    default:
      return Response.json(
        { ok: false, error: "action must be one of: verify | reject | unreject" },
        { status: 400 }
      );
  }
}
