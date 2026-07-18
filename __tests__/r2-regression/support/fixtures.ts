// R2 auth/durability regression pack — shared actor/session fixtures.

export const ACTOR_A = { name: "Josh Owner", email: "josh@example.com" };
export const ACTOR_B = { name: "Other User", email: "other@example.com" };

export const USER_A = { id: "user-a", role: "estimator" as const };
export const USER_B = { id: "user-b", role: "estimator" as const };
export const ADMIN = { id: "user-admin", role: "admin" as const };

/** Two-bid fixture ids used consistently across this pack's cross-bid tests. */
export const BID_A = 1;
export const BID_B = 2;
