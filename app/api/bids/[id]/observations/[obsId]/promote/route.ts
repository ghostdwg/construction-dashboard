import { promoteObservation } from "@/lib/services/tradeResponse/observations";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = { title?: string; description?: string | null; priority?: string; dueDate?: string | null };
export async function POST(request: Request, { params }: { params: Promise<{ id: string; obsId: string }> }) {
  const { id, obsId } = await params;
  const oid = positiveId(obsId);
  if (!oid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await promoteObservation(ctx.bidId, oid, {
    ...json.value,
    dueDate: json.value.dueDate ? new Date(json.value.dueDate) : null,
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}
