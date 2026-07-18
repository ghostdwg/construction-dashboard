import { reviewTradeResponse } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; pkgId: string; itemId: string; revId: string }> }) {
  const { id, pkgId, itemId, revId } = await params;
  const pid = positiveId(pkgId); const iid = positiveId(itemId); const rid = positiveId(revId);
  if (!pid || !iid || !rid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<{ gcReview: string; gcCommentary?: string | null }>(request);
  if (!json.ok) return json.response;
  const result = await reviewTradeResponse(ctx.bidId, pid, iid, rid, json.value, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value });
}
