// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/pursuitPromotion/actor.ts
//  Session → PromotionActor. Shared by the API route and the server components
//  that render promotion controls, so route and page can never disagree about
//  who the caller is.
// ──────────────────────────────────────────────────────────────────────────────

import { auth } from "@/lib/auth";
import { getUser } from "@/lib/auth-helpers";
import type { PromotionActor } from "./types";

/** Returns null when unauthenticated. Honours the AUTH_DISABLED bypass via getUser(). */
export async function resolvePromotionActor(): Promise<PromotionActor | null> {
  const user = await getUser();
  if (!user) return null;
  const session = await auth().catch(() => null);
  const email = (session?.user as { email?: string } | undefined)?.email ?? null;
  return { id: user.id, role: user.role, email };
}
