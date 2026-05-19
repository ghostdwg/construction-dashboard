// PATCH /api/market-intelligence/projects/[id]
//   body: { action: "verify" | "reject" | "stall" | "transition" | "addNote";
//           reason?: string; toState?: LifecycleState; override?: boolean;
//           note?: string }
//
// Admin-only. Returns { ok: boolean, error?: string, data?: ... }.

import { auth } from "@/lib/auth";
import {
  verifyProject,
  rejectProject,
  markProjectStalled,
  transitionProjectState,
  addProjectNote,
} from "@/lib/services/projectGovernance";
import type { LifecycleState } from "@/lib/services/projectAggregation";
import type { GovernanceActorContext } from "@/lib/services/projectGovernance/types";

async function requireAdmin(): Promise<
  | { ok: true; actor: GovernanceActorContext }
  | { ok: false; response: Response }
> {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  if (!user) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { ok: false, response: Response.json({ error: "admin required" }, { status: 403 }) };
  }
  return { ok: true, actor: { userId: user.id ?? null, email: user.email ?? null } };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if (!a.ok) return a.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    reason?: string;
    toState?: LifecycleState;
    override?: boolean;
    note?: string;
  };

  switch (body.action) {
    case "verify": {
      const r = await verifyProject(id, a.actor);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    case "reject": {
      const r = await rejectProject(id, a.actor, body.reason);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    case "stall": {
      const r = await markProjectStalled(id, a.actor, body.reason);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    case "transition": {
      if (!body.toState) {
        return Response.json({ ok: false, error: "toState is required" }, { status: 400 });
      }
      const r = await transitionProjectState(
        {
          projectId: id,
          toState: body.toState,
          reason: body.reason ?? "operator transition",
          override: body.override,
        },
        a.actor
      );
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    case "addNote": {
      if (!body.note) {
        return Response.json({ ok: false, error: "note is required" }, { status: 400 });
      }
      const r = await addProjectNote(id, body.note, a.actor);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    default:
      return Response.json(
        { ok: false, error: "action must be one of: verify | reject | stall | transition | addNote" },
        { status: 400 }
      );
  }
}
