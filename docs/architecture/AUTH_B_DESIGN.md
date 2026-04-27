# Auth B — Per-User Isolation + RBAC Design

## Status: Infrastructure ready, enforcement deferred until second user exists

**Rule:** Full enforcement requires a second real user to test. Build helpers now; wire
query sites when you have two accounts to verify isolation actually works.

---

## Role matrix

| Role | Sees | Can Create | Notes |
|------|------|-----------|-------|
| `admin` | All bids, all users, all config | Everything | You (founder) |
| `estimator` | Own bids (createdById) | Bids, subs, leveling | Default new user role |
| `pm` | Own awarded projects | Construction phase actions | Post-award user |

`User.role` already in schema. JWT already carries role (see `lib/auth.ts` callbacks).

---

## Per-user isolation — the two primitives

Both live in `lib/auth-helpers.ts`.

### `getUser()` — resolves current caller

```typescript
import { getUser } from "@/lib/auth-helpers";

// In a server component:
const user = await getUser();
if (!user) redirect("/login");

// In an API route:
const user = await requireUser(); // throws 401 if not authed
```

Respects `AUTH_DISABLED=true` (returns fake admin — solo dev mode preserved).

### `bidScopeFilter(user)` — Prisma where fragment

```typescript
import { getUser, bidScopeFilter } from "@/lib/auth-helpers";

// In a server component:
const user = await getUser() ?? { id: "", role: "admin" }; // never null when behind auth wall
const bids = await prisma.bid.findMany({
  where: { ...bidScopeFilter(user), status: "active" },
});

// Admin → where: { status: "active" }            (no createdById filter)
// Estimator → where: { createdById: userId, status: "active" }
```

### `assertBidAccess(user, bid)` — row-level guard

```typescript
const bid = await prisma.bid.findUnique({ where: { id: bidId } });
if (!bid) notFound();
assertBidAccess(user, bid); // throws 403 if user doesn't own bid and isn't admin
```

---

## Enforcement sweep — query sites that need updates

When you're ready to enforce (two real users exist), update these sites in order:

### Priority 1 — data-exposing routes

| File | Query | Change |
|------|-------|--------|
| `app/bids/page.tsx` | `prisma.bid.findMany` | add `...bidScopeFilter(user)` |
| `app/layout.tsx` | `prisma.bid.findFirst` (active project) | add `...bidScopeFilter(user)` |
| `app/api/bids/[id]/route.ts` | `prisma.bid.findUnique` | add `assertBidAccess(user, bid)` |
| All `app/api/bids/[id]/*/route.ts` | any bid-scoped query | add `assertBidAccess` or scope filter |

### Priority 2 — cross-project views

| File | Notes |
|------|-------|
| `app/submittals/page.tsx` | filter by bidId from scoped bids |
| `app/meetings/page.tsx` | same pattern |
| `app/tasks/page.tsx` | filter action items to owned bids |

### Priority 3 — sidebar / layout counts

`app/layout.tsx` sidebar counts (bidCount, activeBid) should be scoped after P1 is done.

---

## `Bid.createdById` backfill

Current schema: `createdById String?` — nullable. All existing bids have `null`.

Before enforcement:

1. Find the admin user ID:
   ```sql
   SELECT id FROM "User" WHERE role = 'admin' LIMIT 1;
   ```

2. Backfill:
   ```sql
   UPDATE "Bid" SET "createdById" = '<admin-id>' WHERE "createdById" IS NULL;
   ```

3. After backfill + verification, change schema to `createdById String` (non-nullable)
   and run a migration. This is a stop-and-ask gate.

---

## Adding a second user (when ready)

```bash
# One-shot seed script (create in scripts/create-user.ts):
npx tsx scripts/create-user.ts --email=pm@example.com --role=estimator --password=temp123

# Or via /settings page if a user management UI is built
```

The `scripts/` directory doesn't exist yet — create when needed.

---

## What's NOT in Auth B scope

- OAuth providers (Microsoft, Google) — deferred, infrastructure is in PrismaAdapter already
- Per-bid collaborators (shared access within a role) — not designed
- Sub-facing portal — separate auth system entirely

---

## Implementation sequence (when triggered)

1. Backfill `createdById` on existing bids
2. Add `getUser()` call to `app/layout.tsx`
3. Add `bidScopeFilter(user)` to `app/bids/page.tsx` query
4. Add `assertBidAccess` to each `app/api/bids/[id]/` route handler
5. Sweep cross-project views (submittals, meetings, tasks)
6. Create second test user, verify isolation end-to-end
7. Make `createdById` non-nullable in schema — stop-and-ask gate

---

*NeuroGlitch · GroundworX · April 2026*
