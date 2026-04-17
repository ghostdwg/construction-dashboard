// GET /api/bids/[id]/procore-push/status
//
// Tier F F2 — Returns the most recent push record for each push type,
// plus the bid's linked procoreProjectId.
//
// Response:
//   { procoreProjectId: string | null, pushes: PushStatusItem[] }
//
// Each PushStatusItem:
//   type, pushedAt, created, updated, skipped, errors

import { prisma } from "@/lib/prisma";

export type PushStatusItem = {
  type: string;
  pushedAt: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export async function GET(
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

  // Latest push per type
  const pushTypes = ["vendors", "contacts", "submittals", "budget"];
  const latestByType = await Promise.all(
    pushTypes.map((pt) =>
      prisma.procorePush.findFirst({
        where: { bidId, pushType: pt },
        orderBy: { pushedAt: "desc" },
      })
    )
  );

  const pushes: PushStatusItem[] = latestByType
    .filter((p) => p !== null)
    .map((p) => ({
      type: p!.pushType,
      pushedAt: p!.pushedAt.toISOString(),
      created: p!.created,
      updated: p!.updated,
      skipped: p!.skipped,
      errors: p!.errors ? (JSON.parse(p!.errors) as string[]) : [],
    }));

  return Response.json({
    procoreProjectId: bid.procoreProjectId,
    pushes,
  });
}
