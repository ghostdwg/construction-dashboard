# Market Intelligence → Pursuit Promotion

Status: implemented locally, unit-tested, **never exercised against a live
system**. No migration, no deployment, no live proof. Claims below are tagged
per the Ledger convention: `[V]` source/git-verified, `[INF]` inference,
`[UNK]` unknown.

## What this closes

`market intelligence → pursuit → bid → active project → closeout` previously had
no first link. An operator could discover an opportunity but not act on it
without retyping it, losing where it came from. This adds the transition and the
provenance that makes it auditable in both directions. `[V]`

## Entry points

| Surface | Route | Control |
|---|---|---|
| Market lead detail | `/market-intelligence/[id]` | "Promote to Pursuit" |
| Market project profile | `/market-intelligence/projects/[id]` | "Promote to Pursuit" |
| Pursuit overview | `/bids/[id]` | Origin card (read-only) |

API: `POST` and `GET /api/market-intelligence/promote`. Service:
`lib/services/pursuitPromotion`. `[V]`

## Provenance representation — no migration

| Source | Link | Reverse lookup |
|---|---|---|
| `MarketLead` | `MarketLead.promotedToBidId` FK (already in schema) + `promotedAt`, status → `PROMOTED` | `Bid.marketLeads` |
| `Project` | `ProjectTimelineEvent` with `eventType="PROMOTED_TO_PURSUIT"`, `sourceRefKind="BID"`, `sourceRefId=String(bidId)` | indexed on `sourceRefId` |

`Project` has no FK column to `Bid`, and this sprint was explicitly barred from
authoring a migration. `ProjectTimelineEvent` is already the project's canonical
operator-history surface (every `projectGovernance` action writes there) and
carries `@@index([sourceRefId])`, so the reverse lookup is indexed rather than a
scan. `[V]`

### Deferred schema work (requires its own migration card)

- `Project.promotedToBidId Int?` + relation, mirroring `MarketLead`. Would
  replace the deterministic-PK duplicate guard with a plain unique FK.
- `Bid.estimatedValue Float?` — the source's public estimated value has no Bid
  column today.
- `Bid.sourceUrl String?` — same, for the public source URL.

Until then, both values are shown in the promotion preview under "stays on the
source" so nothing appears to have been silently dropped. `[V]`

## Duplicate protection

Both guards are enforced by the **database**, not by a read-then-write check:

- **Lead** — compare-and-swap:
  `updateMany({ where: { id, promotedToBidId: null } })`. A loser sees
  `count === 0`.
- **Project** — the promotion's `ProjectTimelineEvent.id` is the deterministic
  value `promotion:<projectId>`, so a second concurrent insert violates the
  primary key.

Either way the losing transaction rolls back — **including its `Bid` insert**, so
a race cannot leave an orphan draft — and the caller then re-reads and receives
the winner's pursuit with `reused: true`. Retries are idempotent. `[V]`

## Authorization and scope

- Promotion is a pursuit-phase action: **admin or estimator**. A PM is refused
  (`403`), mirroring `canAccessPhase(user, "BID", "draft")`.
- The new `Bid.createdById` is the promoting actor — this is what scopes the
  pursuit for every downstream bid-scoped route.
- If a source was already promoted to a pursuit the caller **cannot** see, the
  response is `409 already_promoted` **without** the bid id or its owner. An
  unknown source and an unreadable one are both `404`. `[V]`

## Safe field mapping

Carried (`lib/services/pursuitPromotion/mapping.ts`, explicit allowlist, never a
spread):

| Bid column | Lead | Project |
|---|---|---|
| `projectName` | `title` | `workingTitle` |
| `location` | `location` ?? `jurisdiction` | `jurisdiction` |
| `buildingType` | `projectType` | `projectType` |
| `approxSqft` | — | `estimatedSqft` |

Deliberately **not** carried: `aiSummary`, `aiInsights`, `aiScore`,
`emergenceProbability`, `heuristics*` (AI-derived judgement, not public source
fact — a pursuit that quotes a model's guess as intake data is a false record);
`rawText` (unbounded scraped text, reachable via the provenance link instead);
`notes`, `confidence`, `reviewStatus`, `lifecycleState` (market-desk internal
state with no bid-side meaning). `[V]`

`MarketLead.projectType` is a *building use*, not the `Bid.projectType` enum
(`PUBLIC | PRIVATE | NEGOTIATED`); it maps to `Bid.buildingType`.
`Bid.projectType` is left at its schema default so an operator makes that
procurement call explicitly during intake. `[V]`

Nothing bid-side flows the other way: `getPursuitOrigin()` reads market rows
only, so no pricing, subcontractor or preference data can reach the Market
Intelligence wing. `[V]`

## Auditability

Every promotion writes an `AuditEvent` under the new `pursuit_promotion`
category, which is in `DB_PERSISTED_CATEGORIES` (persists forever). The row is
written **inside the promotion transaction**, so a failed audit write rolls the
promotion back — audit may not fail open for an accountability-relevant
mutation. Reuse attempts are audited too (`promote_to_pursuit_reused`).

The payload carries ids, kinds and field *names* only — never source text or
mapped values. `[V]`

## Operator acceptance checklist

Local unit coverage exists for every item below; **none has been exercised on a
live system**. `[UNK]` for live behaviour throughout.

1. Open an eligible lead → "Promote to Pursuit" is enabled.
2. Open an archived/dismissed lead → control is disabled with the reason shown.
3. As a PM → control is disabled ("requires the estimator or admin role").
4. Click Promote → preview lists exactly the four values that will be written,
   plus what stays on the source.
5. Confirm → exactly one draft Bid is created, status `draft`, owned by you.
6. Success state offers direct navigation to the new pursuit.
7. Open that pursuit → Overview shows the origin card linking back, with who
   promoted it and when.
8. Return to the source → "pursuit created" summary + promotion history.
9. Promote the same source again → the existing pursuit is returned, no second
   draft is created.
10. Repeat as a different estimator → told it is already promoted, with no bid
    id disclosed.
11. Repeat steps 1–10 for a market Project profile.

## Known gaps

- **No component-level UI tests.** This repo has no DOM test infrastructure (no
  `jsdom`/`happy-dom`, no `@testing-library`), and `vitest.config.ts` only
  includes `**/*.test.ts`. UI state is therefore tested through
  `previewPromotion()` — which is what drives every rendered state — plus pure
  navigation helpers, rather than by rendering the component. Adding DOM
  infrastructure is a separate, config-changing card. `[V]`
- **Bid-side trades are not auto-populated.** `autoPopulateBidSubs()` is a no-op
  for a brand-new bid (it iterates `bidTrades`, which is empty), so promotion
  does not call it. The existing `POST /api/bids` has the same property. `[V]`
- **No live proof of any kind.** No staging run, no migration, no deployment.
  `[UNK]`
