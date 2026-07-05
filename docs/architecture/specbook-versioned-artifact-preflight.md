# Spec Book Versioned-Artifact Storage — Preflight Brief

- Status: Preflight — planning only, no code in this brief
- Date: 2026-07-05
- Scope: a **future** change to Spec Book's `BlobStore` key shape so that a
  re-upload no longer overwrites the one fixed key a bid's original PDF (and
  its split section PDFs) live at today, but instead gets its own durable,
  non-clobbering artifact — most likely by folding `SpecBook.id` (the row's
  own autoincrementing primary key) into the key. This document contains no
  code changes and authorizes none — it exists so a future implementation
  session has an exact, source-grounded starting point instead of
  re-deriving today's lifecycle, sequencing constraints, and retention
  tradeoffs from scratch.

## Why a brief, not an ADR

This mirrors `docs/architecture/drawings-storage-migration-brief.md`'s own
framing: there is no live "which of three strategies" decision on record
here comparable to `docs/architecture/adr/0001-ai-credential-resolution.md`.
The *pattern* (BlobStore-backed keys, legacy-path compatibility) is already
decided and shipped for Spec Book (`e5d50b0`). What's undecided is a single,
well-scoped follow-on: whether/how to make Spec Book's key shape
non-overwritable. That follow-on was already flagged as a recommendation —
not a decision — in `runtime/runbooks/specbook-staging-validation.md` §8,
written one day before this brief; this document is the promised deeper
preflight for that recommendation. **Judgment call for a human to double
check:** if the eventual implementation prefers a content-hash key
(`{sha256}.pdf`, also raised in that runbook's §8) over a `SpecBook.id`-scoped
key, the retention-policy tradeoffs in §4 below still apply, but the
sequencing problem in §3 disappears entirely (see §3's own note) — that
sub-choice is close enough to a real fork that it may warrant its own ADR
rather than being silently folded into an implementation PR.

---

## 1. Current upload/delete/re-upload lifecycle

**Upload** (`app/api/bids/[id]/specbook/upload/route.ts`, `POST`), exact
current order of operations:

1. Verify the bid exists (`404` if not).
2. Load trades + bid-trade assignments (for section matching later).
3. Parse the multipart body, validate the file is a PDF.
4. Build the buffer and the **fixed** storage key (line 149):
   `` const storageKey = `plan-room/jobs/${bidId}/spec/original.pdf`; ``
5. **Write the blob first**: `await getBlobStore().put(storageKey, buffer);`
   (line 150) — before any `SpecBook` row exists for this upload.
6. `await prisma.specBook.deleteMany({ where: { bidId } });` (line 153) —
   deletes any *prior* `SpecBook` row for the bid; `SpecSection` rows cascade
   via `onDelete: Cascade` (schema-level, confirmed in
   `prisma/schema.prisma`); any `SubmittalItem.specSectionId` pointing at a
   deleted section is set to `NULL` at the DB level (confirmed in every
   `SubmittalItem` migration: `ON DELETE SET NULL` on
   `SubmittalItem_specSectionId_fkey` — this happens automatically, the
   upload route does not do it explicitly the way the DELETE route does).
7. `await prisma.specBook.create({ data: { bidId, fileName, filePath:
   storageKey, status: "processing" } });` (line 156) — **only now** does a
   `SpecBook.id` exist, and it is not used anywhere above.
8. Parse sections (sidecar or `pdfjs-dist` fallback), `createMany` the
   `SpecSection` rows with `source: "specbook"`.
9. `specBook.update({ data: { status: "ready" } })`.
10. Fire-and-forget `generateBidIntelligence` / `triggerBriefRefresh`.

**Split** (`app/api/bids/[id]/specbook/split/route.ts`, `POST`):

1. `prisma.specBook.findFirst({ where: { bidId, status: "ready" }, orderBy: {
   uploadedAt: "desc" } })` — picks the most recent ready book for the bid
   (today this is unambiguous only because step 6 above guarantees at most
   one `SpecBook` row per bid exists at a time).
2. Resolves `specBook.filePath` to an absolute path for the sidecar handoff —
   either the recognized legacy absolute path, or
   `localPathForKey(specBook.filePath)` for the current relative-key shape.
3. Builds a second **fixed** key prefix (line 69):
   `` const sectionsKeyPrefix = `plan-room/jobs/${bidId}/spec/sections`; ``
   — also has no `specBookId` (or any per-book) segment.
4. Hands the sidecar an `output_dir` derived from that prefix; the sidecar
   writes split PDFs directly onto the shared `/storage` mount (no
   `BlobStore.put()` round-trip needed since it's already at its final
   location).
5. `prisma.specSection.deleteMany({ where: { specBookId: specBook.id } })`,
   then `createMany` with `pdfPath: \`${sectionsKeyPrefix}/${s.filename}\``
   (line 156) — again, no `specBookId` in the key; uniqueness comes only from
   the sidecar's own generated filename (CSI-number/title-derived).

**Delete** (`app/api/bids/[id]/specbook/[uploadId]/route.ts`, `DELETE`):

1. `uploadId` (the `SpecBook.id`) arrives as a URL param and is already used
   as a real identifier here — just not as part of any storage *key*.
2. Looks up the `SpecBook` scoped to `{ id: specBookId, bidId }`, including
   `sections: { select: { id, pdfPath } }`.
3. Explicitly `updateMany`s `SubmittalItem` to null `specSectionId` for this
   book's sections (redundant with, but defensive alongside, the DB-level
   `ON DELETE SET NULL`).
4. `prisma.specBook.delete({ where: { id: specBookId } })` — sections cascade.
5. Best-effort deletes **exactly** the artifacts this book is known to own
   (`specBook.filePath` + each section's `pdfPath`, never a prefix sweep) —
   via `blobStore.delete()` for BlobStore keys, `fs.unlink()` for the one
   recognized legacy absolute-path shape.

**Re-upload** = a second call to the same upload route. Because step 4's key
is fixed and step 5 writes before step 6/7 replace the DB row, a re-upload
after a delete and a re-upload *without* an intervening delete are
byte-for-byte indistinguishable at the storage layer — both simply overwrite
`plan-room/jobs/{bidId}/spec/original.pdf`. (This exact observation is
already recorded, independently, in
`runtime/runbooks/specbook-staging-validation.md` §2.6 and §8 — restated here
because it is the direct motivation for this brief.)

---

## 2. Current `filePath`/`pdfPath` key shapes (quoted from source)

| Field | Route / line | Exact template |
|---|---|---|
| `SpecBook.filePath` | `upload/route.ts:149` | `` `plan-room/jobs/${bidId}/spec/original.pdf` `` |
| `SpecSection.pdfPath` | `split/route.ts:69,156` | `` `plan-room/jobs/${bidId}/spec/sections/${s.filename}` `` (prefix built at line 69, joined with the sidecar's own `filename` at line 156) |

**Correction to a prior assumption going into this task:** there is no
`localBlobPath()` or `safeBlobFileName()` helper in this integration branch's
`lib/storage/blobStore.ts` — those names belong to the **production**
branch's independent BlobStore refactor
(`docs/architecture/prod-blobstore-reconciliation-dossier.md` §2, §4), not to
this codebase as it stands. This integration branch's only key-adjacent
helpers are `localPathForKey(key)` (resolves a key to an absolute filesystem
path for the sidecar handoff) and `marketDocKey(sourceId, docId, ext, date)`
(unrelated — builds market-intelligence document keys). **There is no
existing Spec-Book-specific key-building helper today** — both routes above
build the `plan-room/jobs/{bidId}/spec/...` string ad hoc, inline, and
independently (the literal prefix `plan-room/jobs/${bidId}/spec` is
duplicated across the two files, not shared). Any future change should
probably introduce one shared helper (mirroring `marketDocKey`'s shape)
rather than adding a third divergent inline template.

---

## 3. How a SpecBook ID could safely participate in key generation

**Proposed new key shape:**

```
plan-room/jobs/{bidId}/spec/{specBookId}/original.pdf
plan-room/jobs/{bidId}/spec/{specBookId}/sections/{filename}
```

This keeps the existing `plan-room/jobs/{bidId}/spec/...` root (matches
`docs/architecture/STORAGE.md` and `blobStore.ts`'s own header convention —
see §5) and inserts one new path segment, `{specBookId}`, immediately under
it. Every upload gets a `SpecBook.id` that is guaranteed unique and
monotonically increasing by the DB itself — no new ID scheme needs to be
invented, and (per §7) no schema migration is required to make the ID itself
available, since `SpecBook.id` already exists.

**Critical sequencing finding — confirmed directly in the current code (§1,
steps 4–7):** the blob write happens at `upload/route.ts:150`, and the
`SpecBook` row (the only place `specBook.id` comes from) is not created until
`upload/route.ts:156` — six lines and one `deleteMany` later. **The
`SpecBook.id` is not available at the point the current code builds the
storage key.** This is a real sequencing problem, not a hypothetical one, and
any implementation must resolve it. Three options:

1. **Reorder to create-then-write-then-update (recommended).** Move the
   `prisma.specBook.create()` call earlier — immediately after the
   `deleteMany` (`upload/route.ts:153`), with a placeholder or
   soon-to-be-overwritten `filePath` value — then build the real
   `specBookId`-scoped key, write the blob, and follow with a
   `prisma.specBook.update({ where: { id }, data: { filePath: realKey } })`.
   **This has direct precedent already in this exact route**: the same
   pattern (create in one state, mutate the row afterward) already happens
   for `status` (`"processing"` at create, `"ready"` after parsing succeeds
   — lines 156, 204–208). Reusing that precedent means this is a
   two-phase-write change to an existing route, not a novel pattern.
   `filePath` is `String` (non-nullable) in the schema today, so the
   placeholder value must be a real (if temporary) string — e.g. the create
   call could pass the *unversioned* legacy-shaped key as a transient
   placeholder, immediately overwritten by the `update` a few lines later,
   so the row is never left in a state where `filePath` is empty or invalid
   even if the process crashed between create and update (an edge case worth
   a human decision — see §11).
2. **Pre-reserve an ID outside a transaction.** Rejected: there is no
   race-free, portable way to "peek" the next autoincrement value across
   Prisma's supported providers without either a DB-specific sequence call
   or holding a transaction open across the blob write (which would be slow
   and hold a row lock for the duration of a potentially large file write).
   Do not pursue this.
3. **Use a content hash instead of the row ID**, e.g.
   `plan-room/jobs/{bidId}/spec/{sha256}.pdf`. This sidesteps the sequencing
   problem entirely — `BlobStore.put()` already computes and returns
   `sha256` in its `PutResult` (see `lib/storage/blobStore.ts` lines 20–24,
   72–76), so the hash is known before any DB write, no reordering needed.
   This is the alternative `runtime/runbooks/specbook-staging-validation.md`
   §8 raises alongside the `specBookId`-scoped option. Tradeoff: a
   content-hash key naturally **deduplicates** byte-identical re-uploads
   (two uploads of the same PDF land at the same key), which a
   `specBookId`-scoped key does not — whether that's desirable is a judgment
   call for whoever implements this (§11).

This brief's primary recommendation is option 1 (`specBookId`-scoped key via
create-then-write-then-update), because it directly answers the task's
premise (fold the SpecBook row's own ID into the key) and reuses an existing
pattern in the same route; option 3 is flagged as a legitimate alternative a
human should weigh, not dismissed.

---

## 4. Artifact retention/deletion choices

A versioned key shape only *enables* keeping prior originals — it does not,
by itself, decide whether anything actually keeps them. **A subtlety the
proposed key shape introduces that does not exist today:** today, re-upload's
`deleteMany({ where: { bidId } })` never needs to delete the old blob, because
the new upload overwrites the exact same key anyway — the "old" blob is
always trivially replaced. Once keys are versioned, `deleteMany` still
deletes the *DB row*, but nothing deletes the now-distinct, now-orphaned
*blob* at the old `specBookId`-scoped key unless new code is added to do so.
**If this change ships with no accompanying retention decision, the default
outcome is silent unbounded storage growth per bid**, not the "nothing
changes" outcome an implementer might assume. Two concrete options, plus a
hybrid:

**Option A — Keep forever, cleanup only on explicit DELETE.** Re-upload's
`deleteMany` continues to delete the *DB* row (as today), but the code is
changed to *also* call the same artifact-cleanup already implemented in
`[uploadId]/route.ts` (delete the outgoing `SpecBook.filePath` +
its sections' `pdfPath`s) — except now that would delete the very artifact
this whole change is meant to preserve, so this option actually means:
**do not delete the old blob on re-upload; only the explicit DELETE route
(§1) removes blobs, and only for the specific `SpecBook.id` a human/UI
targets.** Old, DB-orphaned blobs (from a re-upload that replaced a row
without an explicit prior DELETE) persist indefinitely with no DB row
pointing at them at all — recoverable only by knowing the bid ID and
enumerating the `plan-room/jobs/{bidId}/spec/` prefix by hand, since nothing
in the DB records "this key exists but its row is gone."
- *Tradeoff:* simplest, zero schema change, matches the "recover a prior
  original" goal literally — but storage grows unbounded, and old-orphaned
  artifacts (DB row deleted, blob still present) are invisible to any
  existing query. `docs/architecture/STORAGE.md` already documents an
  aspirational `_trash/` directory ("soft-deletes for 30 days") that no code
  in this repo actually implements today (confirmed: `_trash` appears only
  in `STORAGE.md` and `runtime/runbooks/staging-backup-restore.md`'s backup
  scope, never in any `.ts` file) — this option would need that concept
  built for real if unbounded growth is unacceptable, which is new scope
  beyond "add an ID to a key."

**Option B — Supersede in place, keep last N (or all) via a new column.**
Change re-upload to **not** delete the old `SpecBook` row at all. Instead,
add a schema column — e.g. `supersededAt DateTime?` (nullable timestamp,
`null` = still the active book) — and re-upload sets `supersededAt: now()`
on the outgoing row instead of deleting it, then creates a new row with
`supersededAt: null`. This requires:
- A migration adding `SpecBook.supersededAt` (or a boolean
  `superseded Boolean @default(false)`; a timestamp is more informative and
  costs nothing extra).
- Every query that currently assumes "the" `SpecBook` for a bid must now
  filter `supersededAt: null` explicitly — concretely, `split/route.ts`'s
  `findFirst({ where: { bidId, status: "ready" } })` would return the
  wrong (most-recent-by-`uploadedAt`, which happens to still be correct only
  because there is currently at most one row) result once multiple
  non-deleted rows coexist per bid unless the query also excludes superseded
  rows.
  ​- Old, superseded `SpecBook` rows' `SpecSection` rows remain in the DB
    (not cascaded away) and remain queryable/linkable — see §6, §9.
  ​- "Keep last N" would need either a scheduled cleanup job (delete rows
    where `supersededAt` is older than N generations back) or simply be left
    unbounded (functionally Option A's growth profile, but with DB rows
    surviving instead of only orphaned blobs) — a genuinely separate policy
    decision layered on top of "supersede instead of delete."
- *Tradeoff:* preserves full section-level and submittal-linkage history
  (see §6, §9) with an explicit, queryable notion of "current" vs.
  "historical" — but is a real schema migration plus query-site audit, not a
  storage-layer-only change.

**Hybrid (C) — append-only history table, unchanged hot path.** Add a
separate `SpecBookVersion` (or similarly named) table that re-upload appends
a row to (old `specBookId`, old `filePath`, `replacedAt`) immediately before
running today's existing `deleteMany` + `create` sequence unchanged. This
keeps every existing "find the current SpecBook for a bid" query exactly as
it is today (no `supersededAt` filtering needed anywhere), while still
recording enough to recover a prior original's blob key on demand. Section-
and submittal-level history (§6, §9) is **not** preserved under this hybrid
unless `SpecSection` rows are also copied into a parallel history shape —
meaningfully less complete than Option B, but with a smaller migration and
zero changes to existing read-query call sites.

No option above is chosen as *the* answer here — this is exactly the kind of
"present at least two, don't pick arbitrarily" decision the task asked for;
§11's rollout plan assumes Option A or B could be swapped in depending on
which a human picks.

---

## 5. Legacy absolute-path compatibility interaction

Per `docs/architecture/prod-blobstore-reconciliation-dossier.md`, production
stores an **absolute filesystem path**
(`/storage/uploads/specbooks/{bidId}/{safeBlobFileName(file.name)}`, no row-ID
segment, no versioning — production's Spec Book code is also
single-canonical-key-per-bid) while this integration branch stores a
**relative BlobStore key** (`plan-room/jobs/{bidId}/spec/original.pdf`). That
dossier's highest-severity finding (§10 bucket b) is that these are two
incompatible **row-shape conventions** in the same untyped `String` column.

Adding a `{specBookId}` segment to integration's relative-key convention does
**not** touch that core mismatch at all — it's still a relative key either
way, so it does not make the absolute-vs-relative reconciliation decision
itself any easier or harder; that decision remains exactly as open as the
dossier already describes, independent of this change. Three second-order
effects worth calling out precisely, though:

- **Neutral for `isLegacyUploadPath()`.** That function only recognizes one
  absolute root; it is indifferent to the internal structure of the
  non-legacy (relative-key) branch. Adding a path segment to the relative-key
  shape requires zero change to any `isLegacyUploadPath()` copy.
- **Genuinely easier for backward-compatibility with rows written *before*
  this change**, for a reason specific to how this codebase already works:
  every route treats `SpecBook.filePath` / `SpecSection.pdfPath` as an
  **opaque, stored, read-back-verbatim string** — never reconstructed from
  `bidId` + a formula at read time (confirmed across `split/route.ts`,
  `[uploadId]/route.ts`, `sections/[sectionId]/pdf/route.ts`, and
  `fileAvailability.ts` — all of them call `getBlobStore().get/exists/delete`
  directly on whatever string is already in the row). This means old rows
  written under the current fixed, unversioned key keep resolving correctly
  with **zero code change** the moment a new key shape starts being written
  for new uploads only — there is no third "legacy shape" branch to add
  anywhere, unlike the Drawing migration brief's analogous case (§4 of that
  document), where changing the convention makes literally every existing
  row "legacy" on day one. Here, the existing rows simply keep working
  through the ordinary non-legacy path, because the stored value was never a
  derived value in the first place.
- **Slightly harder if production's absolute-path shape is later chosen as
  canonical** (one of the dossier's bucket-b options). Production's shape has
  no row-ID or version segment of its own and no versioning behavior at all —
  choosing it as canonical after this change ships would mean re-deriving a
  parallel versioning design against a different codebase and key
  convention, not reusing this brief's design. Not a blocker, but a real
  coordination cost worth naming: this brief's design is scoped to
  integration's existing relative-key convention and does not attempt to
  anticipate production's shape.

---

## 6. Source-provenance implications

`lib/services/specbook/sourceSectionLink.ts` builds a link from
`SubmittalItem.specSectionId` to a **specific `SpecSection` row by its own
`id`** (`prisma/schema.prisma`: `specSection SpecSection? @relation(fields:
[specSectionId], references: [id])`) — never "the current book for this
bid," never anything resolved through `SpecBook`. **This FK is already
unambiguous today at the row level and stays exactly as unambiguous once
multiple `SpecBook`s-with-history can coexist per bid** — introducing
versioned artifacts does not, by itself, break `sourceSectionLink.ts`'s
correctness, because it never assumed "exactly one SpecBook per bid" in the
first place; it only ever assumed "this specific section row still exists
and its file is servable" (which `checkFileAvailability()` in
`fileAvailability.ts` already verifies independently, per section, per call).

What **does** change is upstream of that FK, in whichever retention option
(§4) is chosen:
- Under Option A (delete-on-reupload, as today) or the hybrid (C): old
  `SpecSection` rows are still cascade-deleted on re-upload exactly as today,
  so old `SubmittalItem.specSectionId` links still get `SET NULL`'d exactly
  as today (§1) — the *blob* becomes recoverable-but-orphaned, but the
  section-level linkage is lost identically to today's behavior. Preserving
  the original PDF alone, without also preserving `SpecSection` rows, does
  **not** by itself restore `sourceSectionLink.ts`'s ability to link a
  `SubmittalItem` back to its originating section after a re-upload — a
  human should not assume "we kept the PDF" implies "old submittal links
  still resolve."
- Under Option B (supersede, don't delete): old `SpecSection` rows survive,
  so old `SubmittalItem.specSectionId` links **continue to resolve** through
  `sourceSectionLink.ts` exactly as they did before the re-upload — this is
  the only option of the three that actually preserves submittal-to-section
  provenance across a re-upload, not just the raw PDF bytes.

---

## 7. No-migration vs minimal-migration options (risk-bucket summary)

Reusing the reconciliation dossier's own three-bucket framework:

**(a) Safe to reconcile mechanically — no schema migration needed:**
- Folding `SpecBook.id` into the key shape itself (§3) — `SpecBook.id`
  already exists; this is a pure application-code change to what string gets
  passed to `getBlobStore().put()`/read back later.
- The create-then-write-then-update reordering in `upload/route.ts` (§3,
  option 1) — reuses the existing `status` two-phase-update pattern already
  present in the same route; no new column required.
- Introducing one shared key-building helper (mirroring `marketDocKey`'s
  shape) instead of two independently duplicated inline templates (§2) —
  pure refactor, no schema or behavior change.
- Retention Option A (§4) as stated (keep-forever, cleanup only via existing
  explicit DELETE) — needs no new column; `SpecBook.id`/`filePath` as they
  exist today are sufficient. (Its downside — unbounded, DB-invisible
  orphaned-blob growth — is a real cost, but not a *migration* cost.)
- Retention hybrid (C) in a reduced form (append a row to a brand-new,
  purely-additive history table) is additive-only at the schema level (one
  new table, zero changes to existing tables/columns) — bucket (a) for the
  schema mechanics, though the application-code sequencing (§4) is new logic,
  not purely mechanical.

**(b) Requires a deliberate human decision:**
- Which retention policy (§4: A vs. B vs. hybrid C) — genuinely different
  tradeoffs (storage growth vs. migration size vs. provenance completeness),
  not a mechanical choice.
- Retention Option B specifically requires a **new column**
  (`SpecBook.supersededAt` or `superseded`) and an audit of every "find the
  current SpecBook for a bid" query site to add the corresponding filter —
  this is the one option in §4 that is **not** migration-free.
- The `specBookId`-scoped key (this brief's primary recommendation) vs. the
  content-hash key (§3, option 3) — both solve the task's premise, but have
  different dedup/collision semantics; flagged in this brief's own framing
  section as possibly warranting its own short ADR.
- What happens to prior `SpecSection` rows / `SubmittalItem` links on
  replacement (§6, §9) — coupled to the retention choice, not independently
  decidable.
- Whether the aspirational `_trash/` 30-day soft-delete convention already
  named in `docs/architecture/STORAGE.md` should be built for real as part of
  this change, or left as a documented-but-unimplemented aspiration (as it is
  today) a bit longer.

**(c) Must be live-validated later — cannot be resolved by reading source
alone:**
- Whether any current staging or production `SpecBook` rows already have
  more than one row per bid in some inconsistent state (shouldn't be
  possible given today's `deleteMany`-then-create logic, but has not been
  live-verified in this brief — no DB query was run).
- Whatever storage-growth rate Option A would actually produce in real usage
  (depends on real re-upload frequency per bid, which this brief has no data
  on).
- Whether the create-then-write-then-update reordering (§3) introduces any
  observable behavior change under concurrent re-uploads to the same bid —
  today's single-write-then-replace order and a reordered
  create-then-write-then-update order could behave differently under a race
  between two simultaneous uploads to the same `bidId`; this brief has not
  traced that race in enough detail to certify it's safe, and it should be
  exercised (or at minimum reasoned through explicitly) before implementation,
  not assumed equivalent to today's behavior.

---

## 8. Exact affected routes/tests

**Routes (application code) that would need to change:**
- `app/api/bids/[id]/specbook/upload/route.ts` — key construction (§2, §3),
  create/write/update ordering (§3), and (if Option A/B chosen) whether
  re-upload deletes, supersedes, or leaves prior artifacts untouched (§4).
- `app/api/bids/[id]/specbook/split/route.ts` — `sectionsKeyPrefix` (§2, line
  69) needs the `specBookId` segment; the `findFirst` query (§1, §7 bucket b)
  needs a `supersededAt`-aware filter if Option B is chosen.
- `app/api/bids/[id]/specbook/[uploadId]/route.ts` (DELETE) — no key-shape
  change needed to *use* the new keys (it already reads `specBook.filePath`
  and each section's `pdfPath` verbatim), but its semantics may need revision
  depending on the chosen retention policy (e.g., under Option B, "delete"
  might need to mean something different for an active vs. already-superseded
  row).
- `app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts` — no change
  needed for the key shape itself (reads `pdfPath` verbatim), but should be
  re-checked against whichever retention option is chosen, since it is the
  route that proves old sections stay servable under Option B.
- `lib/services/specbook/fileAvailability.ts` — no change needed for the key
  shape itself (operates on whatever string it's given), but its
  `looksMalformedOrUnsafe()` legacy-path allowlist should be reviewed to
  confirm it still correctly classifies the new, longer key shape as a valid
  BlobStore key (it should — the new shape is still a well-formed relative
  key — but worth an explicit test, see below).
- `lib/services/specbook/sourceSectionLink.ts` — no code change expected
  (§6) — listed here because it is explicitly named in the task's premise as
  a file to re-verify, not because reading it surfaced a required edit.
- A new, currently-nonexistent shared key-builder (optional refactor, §7
  bucket a) — would live in `lib/storage/blobStore.ts` alongside
  `marketDocKey`, e.g. a `specBookKey(bidId, specBookId)` /
  `specSectionKey(bidId, specBookId, filename)` pair.

**Tests that assert today's exact key strings and would need updating:**
- `app/api/bids/[id]/specbook/upload/__tests__/route.test.ts` — lines 223,
  224, 252 assert `blobPutMock` is called with, and `db.specBooks.get(1)?.
  filePath` equals, the literal `"plan-room/jobs/1/spec/original.pdf"`.
- `app/api/bids/[id]/specbook/split/__tests__/route.test.ts` — lines 105,
  126, 134–137, 168, 184 assert the literal `"plan-room/jobs/7/spec/
  original.pdf"` / `"plan-room/jobs/7/spec/sections/..."` shapes, including
  an explicit assertion that a section's `pdfPath` "does not match `/^\//`".
- `app/api/bids/[id]/specbook/[uploadId]/__tests__/route.test.ts` — lines
  84, 92, 111–116, 147–148 build fixtures using the literal
  `"plan-room/jobs/{n}/spec/original.pdf"` shape, including one test that
  specifically constructs an "unrelated key" (`"plan-room/jobs/12/drawings/
  original.pdf"`) to prove delete doesn't touch it, and one that stores a
  traversal payload (`"../../../../etc/passwd"`) as a `pdfPath` to prove it's
  rejected, not unlinked.
- `lib/services/specbook/__tests__/fileAvailability.test.ts` — should gain
  an explicit case asserting the new, longer key shape still resolves to
  `"durable-present"` (not `"invalid"`) through `looksMalformedOrUnsafe()`.
- `lib/services/specbook/__tests__/sourceSectionLink.test.ts` — should be
  re-run as a *no-change confirmation*, not expected to need edits, per §6.
- `lib/storage/__tests__/blobStore.test.ts` — would need new cases only if
  the optional shared key-builder helper (§8 routes list, last item) is
  added; no existing assertions in this file reference the Spec Book key
  shape itself (it tests `LocalBlobStore`/`localPathForKey` generically).
- No test file changes are expected for `app/api/bids/[id]/specbook/gaps/
  __tests__/route.test.ts` or `.../analyze/complete/__tests__/route.test.ts`
  — neither asserts on the storage key shape (confirmed by the earlier grep
  turning up no `original.pdf`/`filePath`-literal hits in either).

---

## 9. What should happen to prior sections on replacement

**Proposed behavior, reasoning below:** tie this directly to whichever
retention option (§4) is chosen, rather than picking independently —

- If **Option A** (keep-blob-only, DB row still deleted on re-upload) is
  chosen: prior `SpecSection` rows are deleted exactly as today (cascade),
  and prior `SubmittalItem` links are `SET NULL`'d exactly as today. The
  preserved original PDF is recoverable as raw bytes (e.g., for a human to
  manually re-run split against it later) but is **not** automatically
  re-linked to anything — this is a deliberate, honest scope limit: "we
  didn't lose the file" is a materially smaller promise than "we didn't lose
  the section-level provenance," and this brief recommends being explicit
  about which one is being delivered if Option A ships.
- If **Option B** (supersede in place) is chosen: prior `SpecSection` rows
  **remain queryable and linkable** — their `pdfPath`s (also newly
  `specBookId`-scoped, per §3's proposed shape extended to sections) continue
  to resolve through the existing `sections/[sectionId]/pdf` route and
  `fileAvailability.ts` exactly as they do for the active book today, and
  `sourceSectionLink.ts`'s existing row-level FK (§6) means old
  `SubmittalItem` links **keep resolving with no code change to that
  module**. This is the more complete answer to "what happens to prior
  sections," at the cost of the schema migration and query-site audit named
  in §4/§7.

This brief recommends Option B's behavior (preserve, don't cascade-delete)
as the one that actually satisfies the spirit of "don't lose history" implied
by the task — but explicitly leaves the choice open per §4/§7's bucket-b
framing, since it is materially more implementation work than Option A.

---

## 10. Interaction with the storage-only smoke mode

A parallel session in this same phase (`feat/specbook-storage-smoke-isolation`,
in a different worktree — not read as part of this brief, per instructions)
is building a storage-only Spec Book smoke mode validating upload → split →
serve → delete → re-upload without triggering AI calls — structurally the
same six-step flow `runtime/runbooks/specbook-staging-validation.md`
documents by hand. Reasoning about the interaction at a design level, without
reading that branch's code:

- That smoke mode's re-upload step almost certainly asserts, or could
  usefully assert, the same thing §2.6 of the staging-validation runbook
  already calls out: that a re-upload produces a **new, distinct
  `SpecBook.id`**, proven at the DB level rather than the storage level
  (since, per that runbook, today's fixed key can't distinguish "delete then
  fresh write" from "overwrite" — the DB row is the only reliable signal
  today).
- Once keys are versioned, that same repeated-re-upload smoke pattern would,
  for the first time, **leave behind an artifact per iteration** rather than
  overwriting one shared key on each pass. A smoke mode that runs
  upload → re-upload → re-upload in a loop (e.g., for repeatability or CI)
  would accumulate one blob per run under Option A unless it also issues an
  explicit DELETE (§1) for each `SpecBook.id` it created — today, by
  contrast, the smoke mode's repeated re-uploads are storage-neutral almost
  by accident, since every pass overwrites the same key.
- This means the smoke mode's own cleanup story (however it's currently
  written) should be revisited **at the point this versioned-key change
  ships**, not before — the smoke mode as designed today is reasoning about
  a single-fixed-key world, and its assumptions (implicit or explicit) about
  "re-upload is storage-neutral" would silently stop being true. This is not
  a conflict to resolve now (this versioned-key change is not implemented
  yet), just a dependency to flag: whoever eventually implements this brief
  should grep the smoke-mode branch for any assumption resembling "re-upload
  doesn't need cleanup because it overwrites" before merging both changes
  together.

---

## 11. Rollout and rollback considerations

**Rollout:**
1. Ship the key-shape change and sequencing fix (§3) behind a simple
   conditional (e.g. an env flag or a feature-flag service already used
   elsewhere in this codebase, if one exists — not verified as part of this
   read-only brief) so new uploads can opt into `specBookId`-scoped keys
   while existing code paths keep writing the old fixed key until the flag
   flips. Because old rows are read back verbatim (§5) and never
   reconstructed from a formula, a **dual-write period is not strictly
   required for correctness** — this is a genuine advantage of this
   specific migration versus ones where the read path assumes a fixed
   convention. A flag is still worth having so the *sequencing* reorder
   (§3, create-then-write-then-update) can be rolled back independently of
   the key-shape decision if the reorder itself turns out to have an
   unexpected interaction (§7 bucket c) under concurrent uploads.
2. No backfill of existing rows is required (§5) — old `filePath`/`pdfPath`
   values keep resolving through the ordinary, unmodified BlobStore branch
   regardless of when the flag flips.
3. If Option B (§4) is chosen, land the schema migration
   (`SpecBook.supersededAt`) and the query-site filter updates (§7, §8)
   *before* flipping the flag that stops deleting old rows on re-upload —
   otherwise a window exists where re-upload neither deletes nor marks
   superseded, silently leaving two "active-looking" rows per bid and
   breaking `split/route.ts`'s `findFirst` assumption.
4. Roll out to staging first and re-run the exact six-step flow
   `runtime/runbooks/specbook-staging-validation.md` already documents,
   specifically re-checking §4's pass/fail table (particularly the
   re-upload row, which currently asserts "new `SpecBook.id` differs from
   the prior one" — that assertion should now also be extended to confirm
   the new blob key differs and, depending on the retention option chosen,
   that the old blob is either still present (Option A/B) or absent
   (neither option proposes deleting the old blob synchronously with
   re-upload, so this should read as present under both currently-favored
   options) at its own now-distinct key.

**Rollback:** because old rows are read back verbatim and the key-shape
change is additive (new segment, not a changed prefix), rolling back is
low-risk: flip the flag back off, and new uploads resume writing the fixed,
unversioned key exactly as they do today; any `SpecBook`/`SpecSection` rows
already written under the new `specBookId`-scoped shape during the rollout
window continue to resolve correctly (their stored `filePath`/`pdfPath` is
still a valid, verbatim-readable BlobStore key — nothing needs to be
"undone" in storage). If Option B's schema migration already landed, rolling
back the *behavior* (stop superseding, resume deleting on re-upload) does not
require reverting the migration itself — the new `supersededAt` column can
simply go unused again; only revert the column if a human decides the
migration itself was a mistake, which is a separate, larger decision than
rolling back this feature's behavior.

---

## Summary for implementers

1. Fold `SpecBook.id` into the key shape:
   `plan-room/jobs/{bidId}/spec/{specBookId}/original.pdf` and
   `.../sections/{specBookId}/{filename}` (or an equivalent segment order —
   not load-bearing which side of `sections/` the ID lands on, as long as
   it's consistent).
2. Fix the sequencing problem first: reorder `upload/route.ts` to
   create-then-write-then-update, reusing the existing `status`
   two-phase-update pattern already in that route (§3).
3. Pick a retention policy (§4) — this brief leans toward Option B
   (supersede, preserve section-level provenance) as the more complete
   answer to the task's spirit, but flags it as materially more migration
   work than Option A and does not treat the choice as forced.
4. Update the four route files and the five test files enumerated in §8;
   no change expected in `sourceSectionLink.ts` itself (§6), though its test
   file should be re-run as a confirmation.
5. No backfill needed regardless of which retention option is chosen (§5,
   §11) — existing rows keep resolving as-is.
6. Coordinate with the parallel storage-smoke-mode branch before merging
   both (§10) — its re-upload loop's implicit "overwrite is storage-neutral"
   assumption stops holding once this ships.
