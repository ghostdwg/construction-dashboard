# Market Intelligence — Product Boundary

Market Intelligence is an **evidence-first intelligence product**, not a manual
sales-lead CRM. This note records the boundary so the drift corrected in
`fix(market-intelligence): restore evidence-first product boundary` does not
reappear.

## Intent

Market Intelligence answers "what is forming, who is working with whom, and what
should we pursue before competitors notice?" from **public and approved
sources**. The pipeline is:

```
public / approved sources
  → source documents & municipal records
  → entities & relationships
  → parcels & ownership history
  → evidence-backed signals
  → emerging project candidates
  → human review
  → optional promotion into a Pursuit
```

Every **Emerging Project** must be compatible with evidence and source lineage.
Operators do not hand-author intelligence candidates.

## Ownership

**Market Intelligence owns:** intelligence overview & briefings, source registry,
municipal meetings, agendas/minutes, source documents, signals, entities &
relationship intelligence, organizations & people, parcels & ownership movement,
emerging projects, watchlists, alerts, forecasting, evidence & citations, and
human-reviewed promotion into a Pursuit.

**Pursuits owns:** manually entered opportunities, invitations received, broker /
customer referrals, owner requests, ordinary business-development intake, and
opportunities promoted from Market Intelligence.

Manual opportunity intake is the **New Bid / Pursuit Intake** flow
(`/bids/new` → `POST /api/bids`). It is independent of Market Intelligence.

## Terminology

The internal `MarketLead` Prisma model represents a machine-derived candidate.
Its internal name is **not** the product name. User-facing surfaces say
**Emerging Project** and use evidence-first wording: detected, emerging, signals,
evidence, confidence, source, relationship, timeline, promote to Pursuit.

Internal identifiers (`MarketLead`, `leadId`, `sourceKind: "LEAD"`, …) are
intentionally left unchanged — renaming them would require migration risk for no
product benefit.

## Creation boundary (load-bearing)

- There is **no** manual browser creation of Emerging Projects. The former
  "New Lead" button/form and the generic manual-write `POST
  /api/market-intelligence/leads` are retired; that route is fail-closed `405`
  with no write path.
- The **only** writer of candidates is the ingestion pipeline
  (`lib/services/marketIntelligence/scrapeOneSource.ts`), which bridges rows into
  `lib/services/liveIngestion/processNewMarketLead` **in-process** — it never
  called the HTTP route. Provenance and server-owned fields are retained there.
- Do not reintroduce a browser creation path, and do not add a public
  service-token bypass that lets operators manufacture evidence-free candidates.

## Promotion (preserve exactly)

The reviewed detected-candidate → Pursuit implementation
(`lib/services/pursuitPromotion/*`) is the single writer of the market→pursuit
link and must be preserved: preview before promotion, one draft Pursuit,
duplicate/concurrent-promotion protection (lead compare-and-swap; project
deterministic timeline PK), rollback / orphan prevention, building-use mapping,
source-to-Pursuit provenance, Pursuit-to-source origin, promotion summary &
history, and authorization + audit behavior.

## Honest states, never fake completion

Areas whose data model exists but which have no finished operator surface
(parcels & ownership, municipal meetings, a standalone source-document index,
typed organizations vs. people) are labelled **foundational** in the intelligence
navigation (`app/(authenticated)/market-intelligence/intelligenceNav.ts`). Routes
and database tables existing is **not** the same as the capability being complete.
See `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §5 for claim discipline.
