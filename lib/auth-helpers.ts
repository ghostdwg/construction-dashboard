// Auth B helpers — per-user isolation + role guards.
//
// These are the two primitives that every query site uses:
//   getUser()         — resolve the current session user (respects AUTH_DISABLED)
//   bidScopeFilter()  — Prisma where-clause fragment that scopes bids by ownership
//
// NEVER modify lib/auth.ts directly. Add new auth utilities here.

import { auth } from "@/lib/auth";

// ── Role constants ─────────────────────────────────────────────────────────

export const ROLES = {
  ADMIN:     "admin",     // Sees all bids, all users, system config
  ESTIMATOR: "estimator", // Owns bids in pursuit / leveling phases
  PM:        "pm",        // Owns bids in post-award / construction phases
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

// ── Current user ───────────────────────────────────────────────────────────

export type AppUser = {
  id:   string;
  role: AppRole;
};

/**
 * Resolve the current authenticated user from the session.
 * Respects AUTH_DISABLED solo-dev bypass (returns a fake admin).
 * Returns null when unauthenticated.
 */
export async function getUser(): Promise<AppUser | null> {
  if (process.env.AUTH_DISABLED === "true") {
    return { id: "dev-admin", role: ROLES.ADMIN };
  }

  const session = await auth();
  if (!session?.user) return null;

  const id   = (session.user as { id?: string }).id;
  const role = (session.user as { role?: string }).role ?? ROLES.ESTIMATOR;

  if (!id) return null;

  return { id, role: role as AppRole };
}

/**
 * Like getUser() but throws a 401 Response if unauthenticated.
 * Use in API route handlers: `const user = await requireUser();`
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getUser();
  if (!user) throw Response.json({ error: "Authentication required" }, { status: 401 });
  return user;
}

// ── Bid scope filter ───────────────────────────────────────────────────────

/**
 * Returns a Prisma `where` fragment that scopes bid queries to the caller.
 *
 * Admin role → no restriction (sees all bids).
 * Estimator / PM → sees only bids where createdById === userId.
 *
 * Usage:
 *   const bids = await prisma.bid.findMany({
 *     where: { ...bidScopeFilter(user), status: "active" }
 *   });
 */
export function bidScopeFilter(user: AppUser): { createdById?: string } {
  if (user.role === ROLES.ADMIN) return {};
  return { createdById: user.id };
}

/**
 * Throws 403 if the user does not own the bid (and is not admin).
 * Use after fetching a bid to enforce row-level access.
 *
 * Usage:
 *   const bid = await prisma.bid.findUnique({ where: { id: bidId } });
 *   if (!bid) notFound();
 *   assertBidAccess(user, bid);
 */
export function assertBidAccess(
  user: AppUser,
  bid: { createdById: string | null }
): void {
  if (user.role === ROLES.ADMIN) return;
  if (bid.createdById === user.id) return;
  throw Response.json({ error: "Forbidden" }, { status: 403 });
}

// ── Role guards ────────────────────────────────────────────────────────────

export function isAdmin(user: AppUser)     { return user.role === ROLES.ADMIN; }
export function isEstimator(user: AppUser) { return user.role === ROLES.ESTIMATOR; }
export function isPM(user: AppUser)        { return user.role === ROLES.PM; }

/**
 * Phase-appropriate role check.
 * Pursuit phase (draft/active/leveling/submitted): estimator or admin.
 * Construction phase (awarded projects): pm or admin.
 */
export function canAccessPhase(
  user: AppUser,
  workflowType: string | null,
  status: string
): boolean {
  if (user.role === ROLES.ADMIN) return true;
  const isConstruction = workflowType === "PROJECT" || status === "awarded";
  if (isConstruction) return user.role === ROLES.PM;
  return user.role === ROLES.ESTIMATOR;
}
