# Spec Book source-evidence linkage — inventory and gaps

Companion to Phase 3's file-availability work (`lib/services/specbook/fileAvailability.ts`).
That work made *whether a Spec Book / Spec Section PDF actually exists* honest.
This note covers the follow-on question: *which AI-generated or derived items
can honestly link back to the spec section they came from?*

## Method

Grepped `prisma/schema.prisma` for every relation that targets `SpecSection`
(searched for the literal string `SpecSection` as a relation target across the
whole file, not just the models we expected).

## Inventory — models with a real FK to SpecSection

| Model | Field | Relation |
|---|---|---|
| `SubmittalItem` | `specSectionId Int?` | `specSection SpecSection? @relation(fields: [specSectionId], references: [id])` |
| `Trade` | (inverse side) | `specSections SpecSection[] @relation("SpecSectionTrade")` |
| `Trade` | (inverse side) | `matchedSpecSections SpecSection[] @relation("MatchedSpecSection")` |

`SubmittalItem.specSectionId` is the only *forward* FK from a derived/AI-facing
item into `SpecSection` — populated by the regex seeder (`seedSubmittalRegister.ts`),
the CSI baseline seeder, `generateFromAiAnalysis.ts` (Phase 5B), and
`organizeWithAi.ts`'s trade-packaging pass. This is the relationship this
change implements a "View source section" action for (see
`lib/services/specbook/sourceSectionLink.ts`, wired into
`app/api/bids/[id]/submittals/packages/route.ts` and the portfolio-wide
`app/submittals/page.tsx`, and rendered in `app/bids/[id]/SubmittalsTab.tsx`).

Referential integrity: `specSectionId` is optional and Prisma's default
`onDelete` for an optional relation left unspecified is `SetNull` — deleting a
`SpecSection` nulls out any `SubmittalItem.specSectionId` that pointed at it
rather than leaving it dangling, *as long as the delete goes through Prisma*.
A raw SQL delete that bypasses Prisma's client-side referential-action
emulation could theoretically leave a stale id (SQLite doesn't enforce FKs by
default), but nothing in this codebase does that today.

## Item types considered and left out — no safe relationship exists yet

- **`AiGapFinding`** (AI review / bid-brief gap findings, Tier 3/AI-review
  module). Has `sourceRef: String?` and `sourceDocument: String?` — both
  free-text fields (e.g. a page reference or document name typed/generated as
  prose), not a foreign key to any row. Linking these to a `SpecSection` would
  require either a new FK column or regexing the free text back to a section
  — the latter is explicitly the kind of fabricated connection this change
  must not build. **Not implemented.**

- **`MeetingActionItem`** (Phase 5D meeting intelligence). Has `sourceText:
  String?` — a paraphrased excerpt from the meeting transcript, not a
  document/section reference of any kind. No spec-section relationship exists
  to represent, safely or otherwise. **Not implemented.**

- **Phase 5H registers (warranty / training / inspections / closeout)**. Per
  `CLAUDE.md`, these are derived on the fly from `SpecSection.aiExtractions`
  JSON (the section's own AI analysis blob), not persisted as their own rows
  with a foreign key — they're read directly off the `SpecSection` they came
  from, so there's no separate model needing a link *back* to it. Out of
  scope for this change (nothing to add), noted here so it isn't mistaken for
  an oversight.

- **`RfiItem`, `BidIntelligenceBrief`, `AiExportBatch`/`GeneratedQuestion`**:
  checked for a `SpecSection` relation; none exists. Not derived from a
  specific spec section in a schema-representable way today.

## What would change this

Any of the free-text-sourced item types above could get a real link in a
future session by adding a genuine `specSectionId Int?` FK column (with a
migration) and populating it at creation time from whatever already-resolved
section the generator was looking at — not by pattern-matching existing
free text after the fact. That's a schema change and explicitly out of scope
here (see `CLAUDE.md` hard constraint: no schema/migration changes in this
task).
