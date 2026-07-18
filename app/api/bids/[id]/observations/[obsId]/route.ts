import { updateOpenObservation } from "@/lib/services/tradeResponse/observations";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = { observationText?: string; sourceLocator?: string | null; observedAt?: string | null };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; obsId: string }> }) {
  const { id, obsId } = await params;
  const oid = positiveId(obsId);
  if (!oid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await updateOpenObservation(ctx.bidId, oid, {
    observationText: json.value.observationText,
    sourceLocator: json.value.sourceLocator,
    ...(json.value.observedAt !== undefined
      ? { observedAt: json.value.observedAt ? new Date(json.value.observedAt) : null }
      : {}),
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value });
}
