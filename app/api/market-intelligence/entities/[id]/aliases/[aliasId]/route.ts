// DELETE /api/market-intelligence/entities/[id]/aliases/[aliasId]
//
// Removes a manually-curated alias from the entity. Admin-only.

import { auth } from "@/lib/auth";
import { removeAlias } from "@/lib/services/entityGovernance";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; aliasId: string }> }
) {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "admin required" }, { status: 403 });

  const { id, aliasId } = await params;
  const result = await removeAlias(id, aliasId, {
    userId: user.id ?? null,
    email: user.email ?? null,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
