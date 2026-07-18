import { createReportObservation, listReportObservations } from "@/lib/services/tradeResponse/observations";
import { bidRouteContext, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = {
  sourceKind: string;
  fieldReportId?: number | null;
  consultantReportId?: number | null;
  observationText: string;
  sourceLocator?: string | null;
  observedAt?: string | null;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  return Response.json({ ok: true, observations: await listReportObservations(ctx.bidId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const body = json.value;
  const result = await createReportObservation(ctx.bidId, {
    ...body,
    observedAt: body.observedAt ? new Date(body.observedAt) : null,
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}
