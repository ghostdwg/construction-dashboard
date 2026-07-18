import { createResponsePackage, listResponsePackages } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = { title: string; contractorId?: number | null; responseDueDate?: string | null };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  return Response.json({ ok: true, packages: await listResponsePackages(ctx.bidId) });
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await createResponsePackage(ctx.bidId, {
    ...json.value,
    responseDueDate: json.value.responseDueDate ? new Date(json.value.responseDueDate) : null,
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}
