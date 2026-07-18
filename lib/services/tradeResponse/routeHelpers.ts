import { requireBidAccess } from "@/lib/auth-helpers";
import type { Actor } from "./types";

export type BidRouteContext =
  | { ok: true; bidId: number; actor: Actor }
  | { ok: false; response: Response };

export async function bidRouteContext(rawBidId: string): Promise<BidRouteContext> {
  const bidId = Number(rawBidId);
  if (!Number.isSafeInteger(bidId) || bidId <= 0) {
    return { ok: false, response: Response.json({ error: "Invalid id" }, { status: 400 }) };
  }
  const access = await requireBidAccess(bidId);
  if (!access.ok) return access;
  return { ok: true, bidId, actor: { id: access.user.id } };
}

export function positiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function readJson<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: (await request.json()) as T };
  } catch {
    return { ok: false, response: Response.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}
