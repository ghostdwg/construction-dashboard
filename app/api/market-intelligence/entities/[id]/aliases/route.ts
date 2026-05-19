// POST /api/market-intelligence/entities/[id]/aliases
//   body: { alias: string; confidence?: "LOW" | "MEDIUM" | "HIGH" | "VERIFIED" }
//
// Adds a manually-curated alias on the entity. Admin-only.

import { auth } from "@/lib/auth";
import { addAlias } from "@/lib/services/entityGovernance";

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
    alias?: string;
    confidence?: "LOW" | "MEDIUM" | "HIGH" | "VERIFIED";
  };
  if (!body.alias || typeof body.alias !== "string") {
    return Response.json({ ok: false, error: "alias is required" }, { status: 400 });
  }

  const result = await addAlias(
    id,
    { alias: body.alias, confidence: body.confidence },
    { userId: user.id ?? null, email: user.email ?? null }
  );
  return Response.json(result, { status: result.ok ? 201 : 400 });
}
