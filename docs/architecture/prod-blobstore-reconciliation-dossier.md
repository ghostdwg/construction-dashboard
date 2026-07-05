# Production BlobStore Reconciliation Dossier

- Status: Analysis only — informs a future human-gated decision, decides nothing
- Date: 2026-07-05
- Scope: exact, source-grounded comparison of `lib/storage/blobStore.ts` and its
  Spec Book call sites on production branch `feat/storage-auth-job-dedupe`
  versus this integration branch, to replace repeated pointer-only references
  to "this needs review" (`docs/architecture/REALITY.md` §3 "Production
  promotion — BLOCKED"; `docs/architecture/drawings-storage-migration-brief.md`
  §7) with an actual side-by-side reading of both diffs.

## Why a dossier, not an ADR

This document does not choose between live options the way
`docs/architecture/adr/0001-ai-credential-resolution.md` does — it has no
"Accepted" decision to record. It also isn't quite the implementation-plan
shape of `docs/architecture/drawings-storage-migration-brief.md`, since there
is no new code being planned here — only two already-written, already-diverged
pieces of code being compared. It is named and scoped like the Drawing brief
(a preflight document for a future session) but is strictly narrower: it does
not propose an implementation, it inventories a conflict precisely enough that
implementation becomes possible. No ADR number is assigned because nothing is
being decided by this document itself.

---

## 1. Exact branches, SHAs, and merge-base examined

Re-derived fresh in this session, not copied from any prior doc:

| Ref | SHA |
|---|---|
| `feat/storage-auth-job-dedupe` (production tip) | `d259b58f886e5b8a7c79e9a3643567802566d099` |
| `HEAD` (this integration branch, `dcee619...`) | `dcee6196d12813f94499c584c18b78fae3200355` |
| `git merge-base feat/storage-auth-job-dedupe HEAD` | `4137ae5d94ff6d8bd322a1ffe949ce7a06bfd982` |

`feat/storage-auth-job-dedupe` resolves locally (`git rev-parse` above
succeeded against a real local ref — no fetch/pull was needed or performed).

**Commits touching `lib/storage/blobStore.ts` since the merge-base:**

- Production (`git log --oneline 4137ae5..feat/storage-auth-job-dedupe -- lib/storage/blobStore.ts`):
  exactly one — `7edbf7e feat(storage): introduce BlobStore path helpers and test scaffolding`.
- Integration (`git log --oneline 4137ae5..HEAD -- lib/storage/blobStore.ts`):
  exactly one — `e5d50b0 fix(specbook): persist artifacts to durable storage`.

**All 7 commits production carries since the merge-base** (confirms the "7
unique stabilization commits" figure in `REALITY.md`/the Drawing brief is
accurate): `7edbf7e`, `1292a6d refactor(uploads): route writes and reads
through BlobStore helpers`, `9be8c5d feat(env): enforce prod-strict validation
and add production-DB startup fence`, `dc07d92 fix(webhooks/procore): expose
through proxy + harden handler to fail closed`, `059d624 fix(jobs/run-due):
emit canonical 'complete' status; back-compat reads`, `bdebefd feat(jobs): add
BackgroundJob.dedupeKey column + service-layer plumbing`, `d259b58
feat(market-intel): activate source-keyed dedupe on queue-scrape + structured
outcome logs`. Only the first two (`7edbf7e`, `1292a6d`) touch storage at all.

---

## 2. Side-by-side semantic comparison of both BlobStore implementations

Both sides implement the same `BlobStore` interface (`put`/`get`/`stat`/
`exists`/`delete`) with a single `LocalBlobStore` (filesystem) backend, wired
through `getBlobStore()` via `STORAGE_BACKEND` (defaults to `"local"`) and
`STORAGE_LOCAL_PATH` (defaults to `/storage`). Neither side has implemented or
stubbed an S3 (or any remote) backend — `getBlobStore()` throws
`Unsupported STORAGE_BACKEND` for anything but `"local"` on both branches.
This much is identical and unchanged from the merge-base.

Where they diverge, in the file itself:

- **Production** adds three free functions right after `assertSafeKey`:
  `getLocalStorageRoot()` (centralizes the `STORAGE_LOCAL_PATH` env lookup +
  absolute-path assertion, previously inlined in `getBlobStore()`),
  `localBlobPath(key)` (validates the key via `assertSafeKey`, then returns
  `path.join(getLocalStorageRoot(), key)` — an **absolute filesystem path**,
  computed without going through the `LocalBlobStore` instance at all), and
  `safeBlobFileName(fileName)` (filename sanitizer). `getBlobStore()` itself
  is lightly refactored to call `getLocalStorageRoot()` instead of inlining
  the env read.
- **Integration** adds a `localPath(key)` **method on the `LocalBlobStore`
  class** (thin wrapper around the private `resolve()` method already used by
  `put`/`get`/`delete`/etc.), plus a module-level `localPathForKey(key)`
  convenience function that calls `getBlobStore()`, asserts the configured
  store `instanceof LocalBlobStore` (throwing otherwise — explicitly a
  local-backend-only escape hatch), and delegates to `store.localPath(key)`.

Structurally: production's new helpers are **free functions that
independently reimplement path resolution** alongside the class (duplicating
the root-lookup + join logic that `LocalBlobStore.resolve()` already does
privately). Integration's new helper **reuses the class's existing private
`resolve()`** through a public method, so there is exactly one path-resolution
code path on the integration side, and two (the class's private `resolve()`
and production's standalone `localBlobPath()`) on the production side. Both
achieve the same practical goal — "give me a real absolute filesystem path
for a key, for handoff to a process that needs one" — via genuinely different
designs. This is the first "changed in both, same intent, different shape"
item that a mechanical merge cannot decide on its own (see §10).

---

## 3. Safe-key validation differences

`assertSafeKey()` itself is **byte-for-byte unchanged on both branches** —
neither side touched it. Both reject: empty/non-string keys, leading `/` or
`\`, any path-traversal segment (`(^|/)\.\.(/|$)` regex), and keys over 1024
characters. No divergence here.

The divergence is in what additionally wraps that check:

- Production's `localBlobPath(key)` calls `assertSafeKey(key)` directly, then
  joins — identical validation guarantee to `LocalBlobStore.resolve()`.
- Integration's `LocalBlobStore.localPath(key)` calls the private `resolve()`
  method, which itself calls `assertSafeKey(key)` — same guarantee, reached
  through the class instead of a standalone function.

**Verdict: functionally equivalent, not stricter or looser on either side.**
Both new call paths route through the exact same `assertSafeKey()` before
touching the filesystem. The real safe-key divergence is not inside
`blobStore.ts` — it is in how the **call sites** decide whether a given
`filePath`/`pdfPath` value is even eligible to be treated as a BlobStore key
at all before handing it to `assertSafeKey`. See §5 and §7: only integration's
call sites implement an `isLegacyUploadPath()` pre-check; production's do not
need one because production never introduced the concept of a "legacy" shape
distinct from its own new shape (see §4).

---

## 4. Local-path derivation differences

Both sides derive a local path as `join(root, key)` where `root` comes from
`STORAGE_LOCAL_PATH` (default `/storage`). The derivation logic is identical.
**What differs is which *keys* get derived, and what gets stored where** —
this is the section that matters most for reconciliation, not the arithmetic
of path-joining itself:

- **Production's key/namespace convention** mirrors the pre-migration
  on-disk layout 1:1, just moved under the durable root:
  `uploads/specbooks/{bidId}/{safeBlobFileName(file.name)}` for the original
  PDF, and `uploads/specbooks/{bidId}/sections/` for split output. Production
  also updated `docs/architecture/STORAGE.md` to document this tree
  (`uploads/estimates/…`, `uploads/specbooks/…`, `uploads/drawings/…`,
  `uploads/addendums/…`, `uploads/meetings/…`).
- **Integration's key/namespace convention** uses
  `plan-room/jobs/{bidId}/spec/original.pdf` and
  `plan-room/jobs/{bidId}/spec/sections/{filename}` — which matches the
  convention **already documented in `blobStore.ts`'s own header comment
  before either branch diverged** (`plan-room/jobs/{jobId}/{kind}/{file}`,
  present verbatim at the merge-base) and is unchanged by integration in
  `STORAGE.md` (integration made zero edits to that doc; `git diff
  4137ae5..HEAD -- docs/architecture/STORAGE.md` is empty).

**These are two different, mutually-exclusive namespace conventions applied
to the same feature (Spec Book), chosen independently on each branch, neither
of which is "wrong" in isolation** — production's choice minimizes migration
blast radius by keeping the exact prior relative directory shape; integration's
choice follows the convention the file itself already documented. This is a
namespace collision risk, not a path-arithmetic bug: if both code paths ever
ran against the same storage root, Spec Book files would land in two
different, non-overlapping subtrees depending on which code handled the
upload, and nothing keys or db rows describe would make that inconsistency
visible without cross-referencing both trees. See §10, bucket (b).

---

## 5. put/get/stat/exists/delete behavior differences

The `LocalBlobStore` methods themselves (`put`, `get`, `stat`, `exists`,
`delete`) are **byte-for-byte unchanged on both branches** — same
`ENOENT`-swallowing behavior on `stat`/`delete`/`exists`, same "throws on
missing" behavior for `get`, same idempotent no-op `delete` of an
already-missing key, same `PutResult`/`Stat` return shapes. Zero divergence
inside the class's own operation semantics.

The divergence is entirely in **how each side's call sites use these
methods** — and this is where a genuine behavioral gap opens up:

- **Production's call sites use `getBlobStore().put()` for the initial write
  only.** Every subsequent operation — verifying the source PDF exists before
  split (`fs.access(specBook.filePath)`), reading it for the sidecar handoff
  (`pdf_path: specBook.filePath` passed as a raw path, not resolved through
  BlobStore), and (in the untouched, production-unmodified `DELETE` route)
  removing it (`fs.unlink(p)`) — is a **direct `fs` call against the absolute
  path stored in the DB**, not a `BlobStore.exists()`/`get()`/`delete()` call.
  Production's own `[uploadId]/route.ts` (DELETE) has **zero diff** against
  the merge-base — production never migrated deletion onto BlobStore at all;
  it still works today only because the absolute path it stores happens to be
  directly `fs.unlink`-able.
- **Integration's call sites always resolve through `getBlobStore()`** —
  `.exists()` before split, `.get()` to serve a section PDF, `.delete()` to
  remove artifacts, and use `localPathForKey()` only for the one case
  (handing an absolute path to the Python sidecar process, which shares the
  same storage mount) where a real filesystem path is unavoidable. Every
  route additionally special-cases exactly one recognized "legacy" absolute
  path shape (`isLegacyUploadPath()`, duplicated near-identically across four
  files: `upload`, `split`, `sections/[sectionId]/pdf`, `[uploadId]` DELETE,
  and once more in `lib/services/specbook/fileAvailability.ts`) for rows that
  pre-date either branch's BlobStore migration.

**Net effect:** production's Spec Book code treats BlobStore as a thin,
optional convenience over ordinary absolute-path filesystem calls; integration
treats BlobStore as the single source of truth for all key-based access, with
one narrowly-scoped exception for pre-migration rows. Neither is "buggy" in
isolation — but they encode two different mental models of what the DB's
`filePath`/`pdfPath` columns *are* (an absolute path to hand to `fs`, versus an
opaque relative key to hand to `BlobStore`). See §6 and §10.

---

## 6. Storage-root and environment-assumption differences

Both sides read the exact same two environment variables
(`STORAGE_BACKEND`, `STORAGE_LOCAL_PATH`) with the exact same defaults
(`"local"`, `/storage`) — no divergence in environment variable names,
defaults, or the assumed container mount path. Production's `7edbf7e` commit
additionally touched `Dockerfile` and `deploy/Dockerfile` to copy
`node_modules/@napi-rs` into the standalone runtime layer (fixing a pdfjs
`DOMMatrix`/`@napi-rs/canvas` warning) and to align `deploy/Dockerfile`'s
storage root with the `/storage` convention — `deploy/` is described in that
commit's message as "the secondary, currently-unused compose" being aligned
proactively. Integration made no changes to either Dockerfile. This is a
low-risk, additive Docker-layer difference, not a BlobStore semantic one —
flagged here for completeness per the task's scan of directly-related files,
not because it conflicts with anything integration does.

---

## 7. Call-site impact from each branch

**Files importing `lib/storage/blobStore.ts`, production
(`feat/storage-auth-job-dedupe`)** — 7 call sites plus 1 test file:

- `app/api/bids/[id]/specbook/upload/route.ts`
- `app/api/bids/[id]/specbook/split/route.ts` (directory prep only — reads/
  deletes still bypass BlobStore, see §5)
- `app/api/bids/[id]/addendums/upload/route.ts`
- `app/api/bids/[id]/drawings/upload/route.ts`
- `app/api/bids/[id]/meetings/[meetingId]/upload-hybrid/route.ts`
- `app/api/bids/[id]/meetings/[meetingId]/source-mapping/route.ts`
- `lib/services/estimateStorage.ts`
- `__tests__/storagePaths.test.ts`

**Files importing `lib/storage/blobStore.ts`, integration (`HEAD`)** — 4
route files plus 1 new service plus their tests:

- `app/api/bids/[id]/specbook/upload/route.ts`
- `app/api/bids/[id]/specbook/split/route.ts` (full read/exists coverage, not
  just directory prep)
- `app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts`
- `app/api/bids/[id]/specbook/[uploadId]/route.ts` (DELETE — **production
  never touched this file at all**)
- `lib/services/specbook/fileAvailability.ts` — **entirely new on
  integration; no analog exists on production.** Resolves a stored
  `filePath`/`pdfPath` reference to one of four states
  (`durable-present`/`legacy-present`/`missing`/`invalid`) so callers can
  surface "re-upload required" proactively instead of on a 404 click-through.
- Corresponding `__tests__/route.test.ts` files for each of the four routes
  above, plus `lib/services/specbook/__tests__/fileAvailability.test.ts`.

**Confirmed unique-to-production call sites integration does not have at
all:** addendums upload, drawings upload, meetings upload-hybrid, meetings
source-mapping, `estimateStorage.ts`. Checked directly against the current
integration tree (`grep` for `fs\.`/`blobStore`/`process.cwd` in each file):
on integration, `app/api/bids/[id]/addendums/upload/route.ts`,
`app/api/bids/[id]/drawings/upload/route.ts`, and
`lib/services/estimateStorage.ts` **still write to
`path.join(process.cwd(), "uploads", …)` today** — container-ephemeral, not
durable. Production migrated these four/five call sites onto BlobStore;
integration has not touched them at all. This is a real capability gap in
integration relative to production, independent of the Spec Book conflict.

**Confirmed unique-to-integration call sites production does not have:** the
DELETE route's BlobStore/legacy-path handling, and the entire
`fileAvailability.ts` proactive-detection feature — production's Spec Book
code has no equivalent of either.

---

## 8. Test coverage available on each side

**Production** — `__tests__/storagePaths.test.ts` (3 tests, read in full):
asserts `localBlobPath("uploads/specbooks/1/book.pdf")` resolves under the
configured `STORAGE_LOCAL_PATH`; asserts `localBlobPath("uploads/../secret.txt")`
throws `/path traversal/`; asserts `safeBlobFileName("../Bid Set #1.pdf")` →
`"Bid Set _1.pdf"`. This is the **only** BlobStore-related test file on
production — no route-level tests exist for Spec Book upload/split/serve/
delete on the production branch at all.

**Integration** — `lib/storage/__tests__/blobStore.test.ts` (5 tests, read in
full): `LocalBlobStore.localPath()` resolves under root, rejects traversal,
rejects a leading-slash key; `localPathForKey()` derives the same path as the
singleton's configured root and rejects traversal identically. Additionally,
integration has **route-level test files for all four migrated Spec Book
routes** plus `fileAvailability.test.ts`. The DELETE route's test file (read
via the read-only merge simulation in this session) asserts, among other
cases: durable artifacts are removed via `BlobStore.delete()` and
`fs.unlink` is *not* called for them; deletion does not touch unrelated keys
under the same bid prefix; legacy absolute paths are unlinked directly via
`fs.unlink`, not through BlobStore; and a corrupted/traversal-like stored
`pdfPath` value is rejected rather than unlinked as an arbitrary path. The
split route's test file similarly asserts the sidecar handoff always receives
a real `/storage/...` path (never a stale `/app/uploads` path) and that
newly-split sections are recorded as relative BlobStore keys, never as the
sidecar's own absolute `pdf_path`.

**Verdict:** integration's test coverage of the Spec Book BlobStore call
sites is substantially deeper (route-level, including the exact
legacy-coexistence and corrupted-key edge cases relevant to reconciliation)
than production's, which only unit-tests the two path-helper functions in
isolation. Conversely, production has zero test coverage for its four/five
*additional* call sites (addendums, drawings, meetings ×2, estimateStorage)
that integration doesn't test either, because integration hasn't touched them.

---

## 9. Migration/database implications

**None found.** `git diff 4137ae5..feat/storage-auth-job-dedupe --name-only --
prisma/migrations/` shows exactly one new migration on production:
`20260516193000_background_job_dedupe_key` (adds `BackgroundJob.dedupeKey`) —
unrelated to storage, Spec Book, or `BlobStore`. Integration's 11 new
migrations since the merge-base are all market-intelligence/runtime-observability
schema work (`mi1_entity_foundation` through `o22_pr3_marketsignal_heuristics`)
— none touch `SpecBook` or `SpecSection`.

Neither branch altered the `SpecBook.filePath` or `SpecSection.pdfPath` column
types — both remain plain, untyped `String` columns on both branches. This
confirms the divergence described in §4–§6 is **purely an application-code
data-shape convention**, not a schema-level conflict — but that is precisely
why it is dangerous rather than reassuring: nothing at the schema level would
prevent both conventions (absolute path vs. relative key, two different
namespace prefixes) from silently coexisting in the same untyped column if
both branches' code ever ran against the same database.

---

## 10. Risk matrix

**(a) Safe to reconcile mechanically** — a pure rename or additive change with
no semantic disagreement:

- The `blobStore.ts` text merge itself. Confirmed via a read-only
  `git merge-tree 4137ae5 feat/storage-auth-job-dedupe HEAD` simulation (no
  working-tree or index mutation) that `lib/storage/blobStore.ts` merges with
  **zero conflict markers** — production's three new free functions
  (`getLocalStorageRoot`, `localBlobPath`, `safeBlobFileName`) and its edit to
  `getBlobStore()`'s body land in different line ranges than integration's new
  `LocalBlobStore.localPath()` method and `localPathForKey()` function, so
  Git's own recursive strategy combines both additions automatically. This is
  the single most load-bearing correction this dossier makes to the prior
  framing in `REALITY.md`/the Drawing brief: **the textual conflict that
  blocks promotion is not, in fact, inside `blobStore.ts` itself.**
- Production's Dockerfile/`deploy/Dockerfile` `@napi-rs` fix (§6) — purely
  additive, no interaction with integration's changes.
- Docker/`STORAGE.md` documentation updates — additive on production, absent
  on integration; no textual collision, safe to layer in.

**(b) Requires a deliberate semantic choice by a human:**

- **Which side's Spec Book route logic wins**, since the *files* actually
  conflict at the text level even though `blobStore.ts` doesn't: the same
  `git merge-tree` simulation shows real `<<<<<<<`/`>>>>>>>` conflict markers
  in `app/api/bids/[id]/specbook/upload/route.ts`,
  `.../specbook/split/route.ts`, and
  `.../specbook/sections/[sectionId]/pdf/route.ts` (plus, unrelated to
  BlobStore, in `lib/env.ts`, `proxy.ts`, and `vitest.config.ts` from other
  stabilization commits on each side — out of this dossier's scope but
  present in the same merge).
- **Absolute-path vs. relative-key data contract for `SpecBook.filePath` /
  `SpecSection.pdfPath`** (§5, §9) — production stores and reads back an
  absolute filesystem path; integration stores and reads back a relative
  BlobStore key. These are incompatible row shapes in the same untyped
  column. **This is the single highest-severity finding in this dossier**,
  confirmed directly in code, not inferred: integration's
  `isLegacyUploadPath()` (duplicated across `upload`, `split`,
  `sections/[sectionId]/pdf`, `[uploadId]` DELETE, and
  `fileAvailability.ts`) recognizes exactly one legacy shape — an absolute
  path rooted at `path.join(process.cwd(), "uploads", "specbooks")`, i.e.
  what existed *before either branch's* BlobStore migration. Production's new
  rows use a **third, different absolute-path shape** —
  `path.join(getLocalStorageRoot(), "uploads", "specbooks", bidId, ...)`,
  typically `/storage/uploads/specbooks/{bidId}/...` — which
  `isLegacyUploadPath()` does **not** recognize. `fileAvailability.ts`'s own
  `looksMalformedOrUnsafe()` explicitly classifies *any* absolute path that
  isn't the one recognized legacy root as `"invalid"` (see its inline
  comment: "anything else absolute is treated as untrusted"). If production's
  row shape were ever read by integration's code as-is, the Spec Book
  serve/split/delete routes would call `getBlobStore().get()`/`.exists()`/
  `.delete()` with a string that starts with `/`, and `assertSafeKey()` (§3)
  would throw `"BlobStore: absolute path not allowed"` — a hard failure, not
  a graceful 404. A human must decide: migrate existing production rows to
  the relative-key shape, extend `isLegacyUploadPath()` to recognize a second
  legacy root, or pick one namespace/contract as canonical going forward and
  write a one-time backfill.
- **Key-namespace convention** (§4) —
  `uploads/specbooks/{bidId}/...` (production) vs.
  `plan-room/jobs/{bidId}/spec/...` (integration, matching the pre-existing
  documented convention in `blobStore.ts`'s header and, historically,
  `STORAGE.md`).
- **Path-resolution design duplication** (§2) — production's standalone
  `localBlobPath()` free function vs. integration's `LocalBlobStore.localPath()`
  method + `localPathForKey()` wrapper. Not a bug in either, but two answers to
  the same design question that should not both survive into one file
  long-term.
- **Call-site coverage merge** (§7) — production's addendums/drawings/
  meetings/estimateStorage migrations are not present on integration at all,
  and integration's `fileAvailability.ts` + DELETE-route migration are not
  present on production. A human should decide whether to carry *both*
  forward (most likely correct, since they are additive and non-overlapping
  in scope) or reconsider either.

**(c) Must be live-validated later** — cannot be resolved by reading source
alone:

- Whether **any production database rows currently exist** in the
  production-shape absolute path (`/storage/uploads/specbooks/{bidId}/...`)
  that would need a backfill under any reconciliation option chosen for the
  item above. This dossier made no live DB query and cannot determine this.
- Whether production's actual mounted `/storage` volume (or whatever
  `STORAGE_LOCAL_PATH` resolves to in the real deployed container) matches
  either side's assumption — `docs/architecture/REALITY.md` §3 already flags,
  independent of this dossier, that Spec Book's end-to-end flow has never
  been validated against real staging, and that staging's own compose config
  has referenced at least one file "no longer... on disk" per prior
  deployed-topology notes. Any reconciliation of `blobStore.ts` inherits that
  same unresolved staging-validation gate — it is not a new risk this dossier
  introduces, but it does directly gate whichever reconciliation is chosen.
- Whether the two vitest suites (`__tests__/storagePaths.test.ts` on
  production, `lib/storage/__tests__/blobStore.test.ts` on integration) can
  coexist cleanly in one process given `getBlobStore()`'s module-level
  `_store` singleton — both suites set `STORAGE_LOCAL_PATH`/`STORAGE_BACKEND`
  via `process.env` before their first call, which works today only because
  each currently runs as the sole consumer of the singleton in its own file;
  running both suites together after a merge should be exercised, not assumed
  clean.

---

## 11. Proposed non-mutating reconciliation sequence

Written as steps for a human, or a future separately-approved session, to
take later — nothing below has been executed as part of producing this
dossier:

1. Confirm current production data shape first: query (in a real,
   change-controlled session, not this one) whether any `SpecBook.filePath` /
   `SpecSection.pdfPath` rows already exist under the production absolute-path
   convention (`/storage/uploads/specbooks/...`) versus the integration
   relative-key convention (`plan-room/jobs/.../spec/...`) versus the
   original pre-migration convention (`process.cwd()/uploads/specbooks/...`).
   This single fact determines how much of steps 2–4 is theoretical versus
   must-handle-real-rows.
2. Decide the canonical key-namespace and data-contract (§10, bucket b, first
   two items) as one decision, not two — the namespace and the
   absolute-vs-relative contract are coupled (integration's relative-key
   convention only works if `isLegacyUploadPath()`-style detection is
   generalized to whatever the chosen legacy root(s) are). Recommendation to
   weigh, not a decision made here: integration's relative-key + documented-
   namespace approach has broader test coverage and matches the file's own
   pre-existing convention, but production's absolute-path approach is what
   is actually live in production today — choosing integration's contract
   means a real backfill of any live production-shaped rows, not just a code
   merge.
3. Once the contract is chosen, create a temporary reconciliation branch off
   the merge-base (`4137ae5`) and cherry-pick production's `7edbf7e` (the
   `blobStore.ts` helper additions) — this step is expected to apply cleanly
   per §10(a)'s merge-tree finding.
4. Layer integration's `e5d50b0` `blobStore.ts` hunks (the `localPath` method
   + `localPathForKey`) on top — again expected to auto-merge cleanly per
   §10(a). At this point `blobStore.ts` itself should require no manual
   conflict resolution.
5. Manually resolve the three genuinely-conflicting call-site files
   (`specbook/upload/route.ts`, `specbook/split/route.ts`,
   `specbook/sections/[sectionId]/pdf/route.ts`) using the chosen contract
   from step 2 as the tiebreaker — not by mechanically picking "ours" or
   "theirs" for each hunk. Concretely: if integration's relative-key contract
   is chosen, port production's `safeBlobFileName()` filename-sanitization
   call into the upload route (integration's upload route does not currently
   sanitize filenames the same way — worth double-checking whether it does
   so elsewhere before assuming a gap); if production's absolute-path
   contract is chosen, port integration's `isLegacyUploadPath()` /
   `fileAvailability.ts` pattern to recognize production's absolute-path shape
   as a first-class (not "legacy") case.
6. Port production's four/five BlobStore-migrated call sites that integration
   never touched (addendums upload, drawings upload, meetings upload-hybrid,
   meetings source-mapping, `estimateStorage.ts`) onto the reconciliation
   branch, using whichever contract was chosen in step 2 — these are additive
   relative to integration and should not conflict with anything integration
   added, but should be re-reviewed against the chosen namespace convention
   (they currently use production's `uploads/{kind}/{id}/...` namespace).
7. Port integration's DELETE-route BlobStore migration and
   `fileAvailability.ts` feature onto the reconciliation branch — additive
   relative to production, no expected conflict.
8. Resolve the incidental, BlobStore-unrelated conflicts this same merge would
   surface in `lib/env.ts`, `proxy.ts`, and `vitest.config.ts` (confirmed via
   the same read-only merge-tree simulation to contain real conflict markers)
   — out of this dossier's scope to analyze in detail, but a real merge
   attempt will hit them and they should not be mistaken for BlobStore
   conflicts when they surface.
9. Run the full test suite from both sides together on the reconciliation
   branch, specifically watching for singleton-state bleed between
   `storagePaths.test.ts` and `blobStore.test.ts` (§10, bucket c) — fix by
   isolating `STORAGE_LOCAL_PATH` per test file/process if any interference
   appears.
10. Only after the above is merged and reviewed: perform the staging
    validation that `docs/architecture/REALITY.md` §3 and the Drawing brief
    §8 both already flag as never having been executed — upload → split →
    list → serve → delete → re-upload, exercised against real staging,
    including a deliberately-seeded legacy-shaped row to confirm coexistence
    actually works outside of unit-test mocks. This is a hard gate before any
    production promotion, independent of and in addition to code
    reconciliation.
11. Only after staging validation passes: consider production promotion. This
    dossier does not authorize or schedule that step.

---

## 12. Explicit statement — analysis only

**No cherry-pick, merge, rebase, production promotion, or runtime change of
any kind was performed while producing this dossier, and none is being
triggered or scheduled by it.** All Git operations used to produce the
findings above were strictly read-only: `git rev-parse`, `git merge-base`,
`git log`, `git diff` (never applied), `git show` (reading blobs from another
branch without checking it out), and one read-only `git merge-tree
<base> <branch1> <branch2>` simulation (which prints a hypothetical merge
result to stdout without touching the working tree, the index, or any ref).
The working branch was never switched away from
`docs/prod-blobstore-reconciliation-dossier`, no branch was checked out or
fetched, and no live system, database, container, or network endpoint was
contacted. This document exists solely to give a future, separately-approved,
human-gated decision the exact facts it needs — it is not itself that
decision.
