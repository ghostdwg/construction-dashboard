import { assignTrackedItemTrades } from "@/lib/services/tradeResponse/observations";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = {
  leadTradeId?: number | null;
  supportingTradeIds?: number[];
  responsibleContractorId?: number | null;
  gcInternalResponsibility?: boolean;
  consultantDiscipline?: string | null;
};
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const tid = positiveId(itemId);
  if (!tid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await assignTrackedItemTrades(ctx.bidId, tid, json.value, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value });
}
