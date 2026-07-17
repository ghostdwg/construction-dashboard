// Module R2-B1 — diarization/transcript corrections (audited overlay over
// immutable originals — R2 rules 5–6).
//
// GET  …/segments/corrections — correction history (append-only log)
// POST …/segments/corrections — apply ONE correction op
//   Body: { correctionType, segmentId?, fromSpeakerLabel?, toValue?,
//           newText?, splitOffset?, secondSpeakerLabel?, reason? }
// History is append-only: PATCH/PUT/DELETE answer 405.

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import {
  applyCorrection,
  listCorrections,
  type CorrectionInput,
} from "@/lib/services/meetingRegister/corrections";
import { isCorrectionType } from "@/lib/services/meetingRegister/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  const corrections = await listCorrections(ctx.bidId, ctx.meetingId);
  return Response.json({ ok: true, corrections });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  let body: CorrectionInput;
  try {
    body = (await request.json()) as CorrectionInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.correctionType || !isCorrectionType(body.correctionType)) {
    return Response.json({ error: "Invalid correctionType" }, { status: 400 });
  }

  const result = await applyCorrection(ctx.bidId, ctx.meetingId, body, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}

const METHOD_NOT_ALLOWED = () =>
  Response.json({ error: "Corrections are append-only" }, { status: 405 });
export const PATCH = METHOD_NOT_ALLOWED;
export const PUT = METHOD_NOT_ALLOWED;
export const DELETE = METHOD_NOT_ALLOWED;
