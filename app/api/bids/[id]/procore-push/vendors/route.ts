// POST /api/bids/[id]/procore-push/vendors
//
// Tier F F2 — Push subcontractors to Procore Company Directory.
// Idempotent: finds-or-creates by name, saves procoreVendorId back to DB.
//
// Response: { ok: true, created, updated, skipped, errors }

import { prisma } from "@/lib/prisma";
import { pushVendors } from "@/lib/services/procore/pushService";
import { ProcoreError } from "@/lib/services/procore/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  try {
    const result = await pushVendors(bidId);

    await prisma.procorePush.create({
      data: {
        bidId,
        pushType: "vendors",
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      },
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof ProcoreError ? err.message : err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
