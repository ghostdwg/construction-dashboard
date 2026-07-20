// ──────────────────────────────────────────────────────────────────────────────
//  POST /api/market-intelligence/promote
//    body: { sourceKind: "LEAD" | "PROJECT", sourceId: string }
//    → 201 { ok: true, bidId, reused: false, ... }   created a draft pursuit
//    → 200 { ok: true, bidId, reused: true,  ... }   idempotent retry
//    → 4xx { ok: false, error: <stable code>, message }
//
//  GET /api/market-intelligence/promote?sourceKind=LEAD&sourceId=abc
//    → 200 { ok: true, preview }  server-authoritative confirm-dialog contents
//
//  Thin shell: every decision lives in lib/services/pursuitPromotion. This file
//  only authenticates, validates the request shape, and maps stable error codes
//  onto HTTP statuses.
//
//  No AI provider is reached on either verb — promotion is pure data mapping.
// ──────────────────────────────────────────────────────────────────────────────

import {
  previewPromotion,
  promoteToPursuit,
} from "@/lib/services/pursuitPromotion";
import { resolvePromotionActor } from "@/lib/services/pursuitPromotion/actor";
import {
  isPromotionSourceKind,
  PROMOTION_ERROR_HTTP_STATUS,
  type PromotionErrorCode,
} from "@/lib/services/pursuitPromotion/types";

function fail(error: PromotionErrorCode, message: string): Response {
  return Response.json(
    { ok: false, error, message },
    { status: PROMOTION_ERROR_HTTP_STATUS[error] }
  );
}

function parseSource(
  kind: unknown,
  id: unknown
): { ok: true; kind: "LEAD" | "PROJECT"; id: string } | { ok: false; response: Response } {
  if (!isPromotionSourceKind(kind)) {
    return {
      ok: false,
      response: fail("invalid_source_kind", "sourceKind must be LEAD or PROJECT."),
    };
  }
  if (typeof id !== "string" || id.trim().length === 0) {
    return {
      ok: false,
      response: fail("invalid_source_id", "sourceId is required."),
    };
  }
  return { ok: true, kind, id: id.trim() };
}

export async function POST(request: Request): Promise<Response> {
  const actor = await resolvePromotionActor();
  if (!actor) return fail("unauthorized", "Authentication required.");

  const body = (await request.json().catch(() => ({}))) as {
    sourceKind?: unknown;
    sourceId?: unknown;
  };

  const parsed = parseSource(body.sourceKind, body.sourceId);
  if (!parsed.ok) return parsed.response;

  const result = await promoteToPursuit(actor, parsed.kind, parsed.id);

  if (!result.ok) {
    return Response.json(result, {
      status: PROMOTION_ERROR_HTTP_STATUS[result.error],
    });
  }
  // 201 for a real create, 200 for an idempotent retry — the caller can tell
  // the two apart without parsing the body.
  return Response.json(result, { status: result.reused ? 200 : 201 });
}

export async function GET(request: Request): Promise<Response> {
  const actor = await resolvePromotionActor();
  if (!actor) return fail("unauthorized", "Authentication required.");

  const url = new URL(request.url);
  const parsed = parseSource(
    url.searchParams.get("sourceKind"),
    url.searchParams.get("sourceId")
  );
  if (!parsed.ok) return parsed.response;

  const preview = await previewPromotion(actor, parsed.kind, parsed.id);

  // A missing source is a 404 even on the preview verb — an unknown id and an
  // id the caller may not read must be indistinguishable.
  if (!preview.eligible && preview.reason === "not_found") {
    return fail("not_found", "Source not found.");
  }

  return Response.json({ ok: true, preview });
}
