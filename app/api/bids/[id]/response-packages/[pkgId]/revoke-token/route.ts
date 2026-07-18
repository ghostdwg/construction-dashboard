import { revokePackageTokens } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; pkgId: string }> }) {
  const { id, pkgId } = await params;
  const pid = positiveId(pkgId);
  if (!pid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const result = await revokePackageTokens(ctx.bidId, pid, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value });
}
