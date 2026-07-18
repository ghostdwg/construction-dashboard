import { preflightExternalResponseItem, submitExternalResponse } from "@/lib/services/tradeResponse/packages";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";
import { externalJson, externalNotFound } from "@/lib/services/tradeResponse/externalHttp";
import { positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";

type Body = {
  responderName: string; responderCompany?: string | null; responseType: string; responseText: string;
  proposedCompletionDate?: string | null; actualCompletionDate?: string | null;
};
export async function POST(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  const iid = positiveId(itemId);
  if (!iid) return externalNotFound();
  if (!(await checkExternalRateLimit(token))) return externalNotFound();
  // Token + package item chain before body parsing; unknown/foreign probes
  // are indistinguishable and cannot induce JSON/provider/mutation work.
  const preflight = await preflightExternalResponseItem(token, iid);
  if (!preflight.ok) return externalNotFound();
  const json = await readJson<Body>(request);
  if (!json.ok) return externalJson({ error: "Invalid JSON body" }, { status: 400 });
  const result = await submitExternalResponse(token, iid, {
    ...json.value,
    proposedCompletionDate: json.value.proposedCompletionDate ? new Date(json.value.proposedCompletionDate) : null,
    actualCompletionDate: json.value.actualCompletionDate ? new Date(json.value.actualCompletionDate) : null,
  });
  return result.ok
    ? externalJson({ ok: true, ...result.value }, { status: 201 })
    : result.error === "Not found"
      ? externalNotFound()
      : externalJson({ error: result.error }, { status: 400 });
}
