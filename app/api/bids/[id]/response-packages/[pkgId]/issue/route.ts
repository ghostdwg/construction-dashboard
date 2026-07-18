import { issueResponsePackage } from "@/lib/services/tradeResponse/packages";
import { bidRouteContext, positiveId, readJson } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

type Body = { delivery: "PORTAL" | "MANUAL"; contractorEmail?: string | null; expiresAt?: string | null; manualChannel?: string | null };
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pkgId: string }> }) {
  const { id, pkgId } = await params;
  const pid = positiveId(pkgId);
  if (!pid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const json = await readJson<Body>(request);
  if (!json.ok) return json.response;
  const result = await issueResponsePackage(ctx.bidId, pid, {
    ...json.value,
    expiresAt: json.value.expiresAt ? new Date(json.value.expiresAt) : null,
  }, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: statusForError(result.error) });
  // rawToken is intentionally returned only by this minting response and is never persisted.
  return Response.json({ ok: true, ...result.value });
}
