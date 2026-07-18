import { preflightExternalResponseItem, submitExternalResponse } from "@/lib/services/tradeResponse/packages";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";
import { positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";

type Body = {
  responderName: string; responderCompany?: string | null; responseType: string; responseText: string;
  proposedCompletionDate?: string | null; actualCompletionDate?: string | null;
};
export async function POST(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  const iid = positiveId(itemId);
  if (!iid) return Response.json({ error: "Not found" }, { status: 404 });
  const hint = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkExternalRateLimit(token, hint)) return Response.json({ error: "Not found" }, { status: 404 });
  // Token + package item chain before body parsing; unknown/foreign probes
  // are indistinguishable and cannot induce JSON/provider/mutation work.
  const preflight = await preflightExternalResponseItem(token, iid);
  if (!preflight.ok) return Response.json({ error: "Not found" }, { status: 404 });
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await submitExternalResponse(token, iid, {
    ...json.value,
    proposedCompletionDate: json.value.proposedCompletionDate ? new Date(json.value.proposedCompletionDate) : null,
    actualCompletionDate: json.value.actualCompletionDate ? new Date(json.value.actualCompletionDate) : null,
  });
  return result.ok
    ? Response.json({ ok: true, ...result.value }, { status: 201 })
    : Response.json({ error: result.error === "Not found" ? "Not found" : result.error }, { status: result.error === "Not found" ? 404 : 400 });
}
