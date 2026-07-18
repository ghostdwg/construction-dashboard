import { submitManualResponse } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = {
  responderName: string; responderCompany?: string | null; channel: string; responseType: string; responseText: string;
  proposedCompletionDate?: string | null; actualCompletionDate?: string | null;
};
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pkgId: string; itemId: string }> }) {
  const { id, pkgId, itemId } = await params;
  const pid = positiveId(pkgId); const iid = positiveId(itemId);
  if (!pid || !iid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await submitManualResponse(ctx.bidId, pid, iid, {
    ...json.value,
    proposedCompletionDate: json.value.proposedCompletionDate ? new Date(json.value.proposedCompletionDate) : null,
    actualCompletionDate: json.value.actualCompletionDate ? new Date(json.value.actualCompletionDate) : null,
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}
