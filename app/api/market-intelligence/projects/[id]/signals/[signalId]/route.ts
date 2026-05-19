// DELETE /api/market-intelligence/projects/[id]/signals/[signalId]
//   query: ?reason=...     (optional)
//   Soft-detaches the ProjectSignal.
//
// POST /api/market-intelligence/projects/[id]/signals/[signalId]
//   body: { reattachTo: string; reason?: string }
//   Reattach the signal to a different project.
//
// Both admin-only.

import { auth } from "@/lib/auth";
import {
  detachProjectSignal,
  reattachProjectSignal,
} from "@/lib/services/projectGovernance";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  if (!user) return { ok: false as const, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { ok: false as const, response: Response.json({ error: "admin required" }, { status: 403 }) };
  }
  return { ok: true as const, actor: { userId: user.id ?? null, email: user.email ?? null } };
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; signalId: string }> }
) {
  const a = await requireAdmin();
  if (!a.ok) return a.response;
  const { id, signalId } = await params;
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") ?? undefined;
  const result = await detachProjectSignal(id, signalId, a.actor, reason);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; signalId: string }> }
) {
  const a = await requireAdmin();
  if (!a.ok) return a.response;
  const { signalId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    reattachTo?: string;
    reason?: string;
  };
  if (!body.reattachTo || typeof body.reattachTo !== "string") {
    return Response.json({ ok: false, error: "reattachTo is required" }, { status: 400 });
  }
  const result = await reattachProjectSignal(signalId, body.reattachTo, a.actor, body.reason);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
