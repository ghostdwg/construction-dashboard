import { getResponsePackage } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId } from "@/lib/services/tradeResponse/routeHelpers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; pkgId: string }> }) {
  const { id, pkgId } = await params;
  const pid = positiveId(pkgId);
  if (!pid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const pkg = await getResponsePackage(ctx.bidId, pid);
  return pkg ? Response.json({ ok: true, package: pkg }) : Response.json({ error: "Not found" }, { status: 404 });
}
