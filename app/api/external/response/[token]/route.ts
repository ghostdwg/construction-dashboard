import { getExternalPackageProjection } from "@/lib/services/tradeResponse/packages";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientHint = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkExternalRateLimit(token, clientHint)) return Response.json({ error: "Not found" }, { status: 404 });
  const result = await getExternalPackageProjection(token);
  return result.ok ? Response.json({ ok: true, package: result.value }) : Response.json({ error: "Not found" }, { status: 404 });
}
