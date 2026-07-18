import { transitionResponsePackage } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; pkgId: string }> }) {
  const { id, pkgId } = await params;
  const pid = positiveId(pkgId);
  if (!pid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<{ to: string }>(request);
  if (!json.ok) return json.response;
  const result = await transitionResponsePackage(ctx.bidId, pid, json.value.to, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value });
}
