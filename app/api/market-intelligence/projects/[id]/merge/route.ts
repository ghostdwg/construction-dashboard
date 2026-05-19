// POST /api/market-intelligence/projects/[id]/merge
//   body: { targetProjectId: string; dryRun?: boolean }
//
// Admin-only. Merges the project identified by [id] INTO targetProjectId.
// On dryRun=true returns the merge plan without writes.

import { auth } from "@/lib/auth";
import { mergeProjects, planProjectMerge } from "@/lib/services/projectGovernance";

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
    targetProjectId?: string;
    dryRun?: boolean;
  };
  if (!body.targetProjectId || typeof body.targetProjectId !== "string") {
    return Response.json({ ok: false, error: "targetProjectId is required" }, { status: 400 });
  }

  if (body.dryRun) {
    const plan = await planProjectMerge(id, body.targetProjectId);
    return Response.json(plan, { status: plan.ok ? 200 : 400 });
  }

  const result = await mergeProjects(id, body.targetProjectId, {
    userId: user.id ?? null,
    email: user.email ?? null,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
