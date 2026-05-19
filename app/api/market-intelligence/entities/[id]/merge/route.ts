// POST /api/market-intelligence/entities/[id]/merge
//   body: { targetEntityId: string; dryRun?: boolean }
//
// Merges the entity identified by [id] INTO targetEntityId. When dryRun=true,
// returns the merge plan without performing writes. Admin-only.

import { auth } from "@/lib/auth";
import { mergeEntities, planMerge } from "@/lib/services/entityGovernance";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "admin required" }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    targetEntityId?: string;
    dryRun?: boolean;
  };
  if (!body.targetEntityId || typeof body.targetEntityId !== "string") {
    return Response.json({ ok: false, error: "targetEntityId is required" }, { status: 400 });
  }

  if (body.dryRun) {
    const plan = await planMerge(id, body.targetEntityId);
    return Response.json(plan, { status: plan.ok ? 200 : 400 });
  }

  const result = await mergeEntities(id, body.targetEntityId, {
    userId: user.id ?? null,
    email: user.email ?? null,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
