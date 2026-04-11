// POST /api/bids/[id]/submittals/seed
//
// Runs the regex-based submittal register seeder. Idempotent — safe to run
// multiple times. Returns counts of scanned / created / skipped.

import { seedSubmittalRegister } from "@/lib/services/submittal/seedSubmittalRegister";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const result = await seedSubmittalRegister(bidId);
    return Response.json(result);
  } catch (err) {
    console.error("[POST /api/bids/:id/submittals/seed]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
