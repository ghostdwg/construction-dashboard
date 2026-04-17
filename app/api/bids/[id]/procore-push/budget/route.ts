// POST /api/bids/[id]/procore-push/budget
//
// Tier F F2 — Push budget lines to the linked Procore project.
// Requires bid.procoreProjectId to be set.
// Fetches Procore cost codes and matches by code string; skips unmatched lines.
//
// Response: { ok: true, created, updated, skipped, errors }

import { prisma } from "@/lib/prisma";
import { pushBudget } from "@/lib/services/procore/pushService";
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
  if (!bid.procoreProjectId)
    return Response.json(
      { error: "No Procore project linked. Connect a project before pushing budget lines." },
      { status: 400 }
    );

  try {
    const result = await pushBudget(bidId, bid.procoreProjectId);

    await prisma.procorePush.create({
      data: {
        bidId,
        pushType: "budget",
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
