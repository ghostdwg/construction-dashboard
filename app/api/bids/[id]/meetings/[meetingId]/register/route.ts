// Module R2-B1 — Meeting Register collection.
//
// GET  …/register?entryType=&reviewState=   — list entries (filtered)
// POST …/register                            — manual entry (lands CONFIRMED)
// Auth: requireBidAccess before any body parsing or service work.

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import {
  createManualEntry,
  listEntries,
  type ManualEntryInput,
} from "@/lib/services/meetingRegister/register";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const entries = await listEntries(ctx.bidId, ctx.meetingId, {
    entryType: url.searchParams.get("entryType") ?? undefined,
    reviewState: url.searchParams.get("reviewState") ?? undefined,
  });
  return Response.json({ ok: true, entries });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  let body: ManualEntryInput;
  try {
    body = (await request.json()) as ManualEntryInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await createManualEntry(ctx.bidId, ctx.meetingId, body, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}
