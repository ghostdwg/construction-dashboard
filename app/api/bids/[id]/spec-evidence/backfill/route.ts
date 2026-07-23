import { requireBidAccess } from "@/lib/auth-helpers";
import { runSpecEvidenceBackfill } from "@/lib/services/specEvidence/backfill";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bidId = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  return Response.json(await runSpecEvidenceBackfill(bidId));
}
