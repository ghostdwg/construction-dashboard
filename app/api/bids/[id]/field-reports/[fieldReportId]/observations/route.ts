import { createReportObservation } from "@/lib/services/tradeResponse/observations";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = { observationText: string; sourceLocator?: string | null; observedAt?: string | null };

export async function POST(request: Request, { params }: { params: Promise<{ id: string; fieldReportId: string }> }) {
  const { id, fieldReportId } = await params;
  const rid = positiveId(fieldReportId);
  if (!rid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await createReportObservation(ctx.bidId, {
    sourceKind: "field_report",
    fieldReportId: rid,
    observationText: json.value.observationText,
    sourceLocator: json.value.sourceLocator,
    observedAt: json.value.observedAt ? new Date(json.value.observedAt) : null,
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}
