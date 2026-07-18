import { changePackageItem } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = { action: "ADD" | "REMOVE"; trackedItemId: number; displayNumber?: string | null };
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pkgId: string }> }) {
  const { id, pkgId } = await params;
  const pid = positiveId(pkgId);
  if (!pid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await changePackageItem(ctx.bidId, pid, json.value, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: json.value.action === "ADD" ? 201 : 200 });
}
