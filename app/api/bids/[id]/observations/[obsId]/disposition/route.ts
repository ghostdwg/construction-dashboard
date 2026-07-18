import { dispositionObservation } from "@/lib/services/tradeResponse/observations";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; obsId: string }> }) {
  const { id, obsId } = await params;
  const oid = positiveId(obsId);
  if (!oid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<{ disposition: string; reason?: string | null }>(request);
  if (!json.ok) return json.response;
  const result = await dispositionObservation(ctx.bidId, oid, json.value, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value });
}
