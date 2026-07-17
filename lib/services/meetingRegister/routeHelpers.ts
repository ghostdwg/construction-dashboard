// lib/services/meetingRegister/routeHelpers.ts
//
// Module R2-B1 — shared route-context resolver for meeting-scoped API
// routes. Composes id validation + requireBidAccess (ALWAYS before body
// parsing — Codex review rule) + session-actor resolution. Under the
// AUTH_DISABLED dev bypass there is no session, so the actor falls back to
// the resolved AppUser id — a mutation can never proceed authorless.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import type { Actor } from "./types";

export type MeetingRouteContext =
  | { ok: true; bidId: number; meetingId: number; actor: Actor }
  | { ok: false; response: Response };

export async function meetingRouteContext(
  idParam: string,
  meetingIdParam: string
): Promise<MeetingRouteContext> {
  const bidId = parseInt(idParam, 10);
  const meetingId = parseInt(meetingIdParam, 10);
  if (isNaN(bidId) || isNaN(meetingId)) {
    return {
      ok: false,
      response: Response.json({ error: "Invalid id" }, { status: 400 }),
    };
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return { ok: false, response: access.response };

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;
  return {
    ok: true,
    bidId,
    meetingId,
    actor: { name: su?.name ?? access.user.id, email: su?.email ?? null },
  };
}

export function serviceStatus(error: string): number {
  return error === "Not found" ? 404 : 400;
}
