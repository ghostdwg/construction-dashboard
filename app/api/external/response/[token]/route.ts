import { getExternalPackageProjection } from "@/lib/services/tradeResponse/packages";
import { externalJson, externalNotFound } from "@/lib/services/tradeResponse/externalHttp";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await checkExternalRateLimit(token))) return externalNotFound();
  const result = await getExternalPackageProjection(token);
  return result.ok
    ? externalJson({ ok: true, package: result.value })
    : externalNotFound();
}
