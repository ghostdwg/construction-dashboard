// POST /api/bids/[id]/procore-pull/rfis
//
// Tier F F3 — Pull RFIs from the linked Procore project.
// Upserts into RfiItem (create new, update existing by procoreRfiId).
// Requires bid.procoreProjectId to be set.
//
// Response: { ok: true, created, updated, skipped, errors }

import { prisma } from "@/lib/prisma";
import { pullRfis } from "@/lib/services/procore/syncService";
import { ProcoreError } from "@/lib/services/procore/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, procoreProjectId: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });
  if (!bid.procoreProjectId) {
    return Response.json(
      { error: "No Procore project linked to this bid. Link one in the Procore tab." },
      { status: 400 }
    );
  }

  try {
    const result = await pullRfis(bidId, bid.procoreProjectId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof ProcoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
