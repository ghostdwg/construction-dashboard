import { getExternalPackageProjection } from "@/lib/services/tradeResponse/packages";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientHint = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkExternalRateLimit(token, clientHint)) return Response.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
  const result = await getExternalPackageProjection(token);
  return result.ok
    ? Response.json({ ok: true, package: result.value }, { headers: PRIVATE_HEADERS })
    : Response.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
}
