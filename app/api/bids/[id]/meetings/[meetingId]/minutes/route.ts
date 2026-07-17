// Module R2-B1 — meeting minutes revisions (R2 rule 9).
//
// GET  …/minutes — list immutable revisions (newest first)
// POST …/minutes — publish (revision 0) or amend (revision n+1; requires
//                  amendmentReason). Gated: no undispositioned extracted
//                  register entries (R2 rule 11).
// Revisions are immutable: PATCH/PUT/DELETE answer 405.

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { listRevisions, publishMinutes } from "@/lib/services/meetingRegister/minutes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  const revisions = await listRevisions(ctx.bidId, ctx.meetingId);
  return Response.json({ ok: true, revisions });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  let body: { amendmentReason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await publishMinutes(ctx.bidId, ctx.meetingId, body, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}

const METHOD_NOT_ALLOWED = () =>
  Response.json({ error: "Minutes revisions are immutable" }, { status: 405 });
export const PATCH = METHOD_NOT_ALLOWED;
export const PUT = METHOD_NOT_ALLOWED;
export const DELETE = METHOD_NOT_ALLOWED;
