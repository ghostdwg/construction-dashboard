# Drawing Durable-Storage Migration — Preflight Brief

- Status: Preflight — planning only, no code in this brief
- Date: 2026-07-04
- Scope: a **future** migration of Drawing file storage (`DrawingUpload.filePath` and
  the routes that read/write it) from raw filesystem paths onto the `BlobStore`
  pattern already in production for Spec Book (`SpecBook.filePath`,
  `SpecSection.pdfPath`). This document contains no code changes and authorizes
  none — it is written so that a future implementation session has an exact,
  source-grounded starting point instead of re-discovering the Spec Book pattern
  from scratch.

## Why a brief, not an ADR

Spec Book's migration onto `BlobStore` already happened and is merged onto this
branch (commit `e5d50b0`, "fix(specbook): persist artifacts to durable storage" —
an ancestor of the commit this brief is based on, `f1e87e1`). There is no longer
an open question of *whether* durable, BlobStore-backed storage is the right
direction for document artifacts in this codebase, or *what shape* that takes —
`lib/storage/blobStore.ts`, its key-namespacing convention, and its
legacy-path-compatibility pattern are all already decided and shipped. What
remains for Drawing is applying an already-decided pattern to a second module,
which is an implementation plan, not a decision record. Contrast with
`docs/architecture/adr/0001-ai-credential-resolution.md`, which exists because
three genuinely different resolution strategies (A/B/C) were live options with
no precedent yet chosen. Nothing analogous is true here. **Judgment call for a
human to double-check:** if the eventual implementation decides the
per-discipline multi-upload shape (see §5) needs a materially different
`BlobStore` key strategy than Spec Book's single-canonical-key-per-bid
convention, that specific sub-decision might warrant its own short ADR — this
brief proposes an answer (§5) but does not treat it as forced.

---

## 1. Current drawing routes — exact paths and storage behavior today

| Route | Method | Storage behavior today |
|---|---|---|
| `app/api/bids/[id]/drawings/upload/route.ts` | POST | Writes the uploaded PDF to a **raw filesystem path**: `path.join(process.cwd(), "uploads", "drawings", String(bidId), file.name)` (line 89–93). Stores that absolute path verbatim in `DrawingUpload.filePath` (line 107). Parses sheet text in-process via `pdfjs-dist` — no BlobStore, no sidecar call, in this route. |
| `app/api/bids/[id]/drawings/[uploadId]/route.ts` | DELETE | Reads `filePath` from the DB row, deletes the `DrawingUpload` row (sheets cascade), then unconditionally calls `fs.unlink(upload.filePath)` best-effort (line 27). No BlobStore awareness, no legacy/new branching — today there is only one shape (raw fs), so none is needed yet. |
| `app/api/bids/[id]/drawings/analyze/route.ts` | POST | Sends `{ file_path: upload.filePath, tier, model }` as a **JSON body** to the sidecar's `/parse/drawings/analyze` (line 48) — the raw absolute filesystem path is handed to the sidecar directly, not a BlobStore key, not file bytes. |
| `app/api/bids/[id]/drawings/analyze/route.ts` | GET | Pure DB read of the most recent `DrawingUpload`'s `analysisJson`/`analysisStatus` fields. No file access at all. |
| `app/api/bids/[id]/drawings/split/route.ts` | POST | **Does not touch the DB, BlobStore, or any persisted file.** It streams the incoming multipart `file` straight through to the sidecar's `/parse/drawings/split` as a new multipart form (line 30–39) — this is a pre-upload discipline-detection *preview*, called before the user confirms and actually persists anything via the upload route above. |
| `app/api/bids/[id]/drawings/gaps/route.ts` | GET | Pure DB read (`DrawingUpload` + `DrawingSheet`, with trade joins). No file access. |
| `app/api/bids/[id]/drawings/rematch/route.ts` | POST | Pure DB read/write of `DrawingSheet.tradeId`/`matchedTradeId`. No file access. |

**Notable gap:** unlike Spec Book (which has
`app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts` to stream a
section's PDF back to the browser), **no route today serves the raw drawing
PDF bytes back to a client.** A migration should decide explicitly whether to
add a serve route as part of the same change, or defer it — §6 lists tests for
both possibilities.

## 2. Filesystem path pattern and sidecar handoff mechanism

**Current raw filesystem path pattern (the only one that exists today):**

```
{process.cwd()}/uploads/drawings/{bidId}/{originalFileName}
```

Built and written in `upload/route.ts` (`fs.mkdir(..., { recursive: true })`
then `fs.writeFile(filePath, buffer)`); this exact absolute path is what's
persisted into `DrawingUpload.filePath` and is later read back verbatim by
delete and analyze.

**Sidecar handoff — two distinct shapes exist, not one:**

1. **Path-based handoff (`analyze`)** — the TS route never reads the file
   itself; it forwards the stored absolute path as JSON (`file_path`).
   `sidecar/routers/drawings.py`'s `AnalyzeRequest.file_path: str` is checked
   with a bare `os.path.exists(body.file_path)` (line 60) and then handed
   straight to `sidecar/services/drawing_intelligence.py:analyze_drawings(pdf_path, ...)`,
   which calls `fitz.open(pdf_path)` (PyMuPDF) directly on that path. This
   requires the sidecar container to see the identical absolute path as the
   Next.js process — today that works only because both currently write/read
   under paths on a shared mount, matching exactly the assumption Spec Book's
   `split/route.ts` already makes explicit and solves with `localPathForKey()`
   (see §4).
2. **Direct-bytes multipart handoff (`split`)** — the TS route never persists
   anything; it re-wraps the client's uploaded `File` into a new `FormData`
   and POSTs the raw bytes to the sidecar's `/parse/drawings/split`.
   `sidecar/routers/drawings.py`'s `_save_upload()` streams that upload to a
   `tempfile.NamedTemporaryFile`, `split_drawing_set()` runs against the temp
   path, and the `finally` block `os.unlink(tmp_path)`s it (lines 21–40,
   96–99) — fully stateless, zero interaction with `DrawingUpload`/BlobStore.
   **This path is out of scope for the storage migration** — there is no
   persisted artifact here to migrate; it stays exactly as-is.

Only handoff (1) is relevant to a BlobStore migration, and it is structurally
identical to what Spec Book's `split/route.ts` already solved: resolve a real
absolute filesystem path for the sidecar (`localPathForKey(key)`), guard with
an existence check first, and never hand the sidecar a bare relative BlobStore
key (the sidecar has, and per ADR 0001-adjacent reasoning should keep, zero
BlobStore-awareness of its own).

## 3. Existing DrawingUpload / DrawingSheet fields a migration can reuse

From `prisma/schema.prisma` (lines 626–699), nothing invented:

**`DrawingUpload`** — `id`, `bidId`, `fileName`, **`filePath`** (the
storage-relevant field — this is the one whose *meaning* changes from
"absolute fs path" to "BlobStore key," exactly mirroring what happened to
`SpecBook.filePath`), `uploadedAt`, `status`, `discipline` (`FULLSET` |
`GENERAL` | `CIVIL` | `ARCH` | `STRUCT` | `MECH` | `ELEC` | `PLUMB` |
`INTERIOR` | `FP`), `analysisStatus`, `analysisTier`, `analysisModel`,
`analysisJson`, `analysisGeneratedAt`.

**`DrawingSheet`** — `id`, `drawingUploadId`, `sheetNumber`, `sheetTitle`,
`discipline`, `matchedTradeId`, `tradeId`, `createdAt`. **No storage-relevant
fields** — unlike `SpecSection.pdfPath` (which holds a per-section split PDF),
`DrawingSheet` has no per-row file artifact of its own, because Drawing has no
persisted "split into pieces" step today — `drawings/split` (§1, §2) is an
ephemeral preview, not a persistence step. A migration should **not** invent a
`DrawingSheet`-level path/key field; there is nothing in the current code that
produces a per-sheet file to store one for.

No `blobKey`, `storageKey`, or similar field exists on either model today —
same starting point `SpecBook` had before `e5d50b0`.

## 4. Legacy-path compatibility shape — proposal, mirroring Spec Book exactly

Spec Book's shipped pattern (present in `[uploadId]/route.ts`,
`sections/[sectionId]/pdf/route.ts`, and `split/route.ts`, all three
identical):

```ts
const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "specbooks");
function isLegacyUploadPath(p: string): boolean {
  return path.isAbsolute(p) && (p === LEGACY_UPLOAD_ROOT || p.startsWith(LEGACY_UPLOAD_ROOT + path.sep));
}
```

Any stored `filePath`/`pdfPath` matching this shape is unlinked/read directly
via `fs`; anything else is treated as a BlobStore key and never opened as an
arbitrary filesystem path (this is also the traversal/safety boundary —
`assertSafeKey()` inside `blobStore.ts` already rejects absolute-looking or
`..`-containing keys, so an unrecognized non-legacy value fails closed rather
than being read as a path).

**Proposed Drawing analog** (same shape, new root):

```ts
const LEGACY_DRAWING_ROOT = path.join(process.cwd(), "uploads", "drawings");
function isLegacyDrawingPath(p: string): boolean {
  return path.isAbsolute(p) && (p === LEGACY_DRAWING_ROOT || p.startsWith(LEGACY_DRAWING_ROOT + path.sep));
}
```

One important asymmetry to flag explicitly: when Spec Book migrated, the
legacy root covered a shrinking minority of *older* rows written before the
cutover. For Drawing, **every existing row today** would be "legacy" the
instant this migration ships — `isLegacyDrawingPath` covers 100% of current
production data on day one, and only newly-created uploads after the
migration lands would get real BlobStore keys. That's expected and fine (it's
exactly how Spec Book's own cutover moment worked), but it means the
legacy-path branch is not a rarely-hit corner case at first — it is the
common case until existing bids re-upload their drawings, and test coverage
(§6) must weight it accordingly.

Applies to: the delete route (unlink-vs-`blobStore.delete`), the analyze
route (resolve `file_path` for the sidecar via `localPathForKey()` for new
rows, pass the stored absolute path through as-is for legacy rows — mirroring
`specbook/split/route.ts`'s `sourcePdfPath` branch exactly), and any future
serve route (§1's gap).

## 5. Proposed BlobStore key convention for Drawings

Spec Book's shipped keys, for reference (`upload/route.ts` line 149,
`split/route.ts` line 69/156):

```
plan-room/jobs/{bidId}/spec/original.pdf
plan-room/jobs/{bidId}/spec/sections/{filename}
```

`docs/architecture/STORAGE.md`'s layout diagram already anticipates a
`drawings/` sibling under the same `plan-room/jobs/{jobId}/` prefix (`original.pdf`,
`pages/`, `thumbnails/` — written before per-discipline uploads existed, so it
doesn't yet reflect that a bid can have several concurrent `DrawingUpload`
rows distinguished by `discipline`, which Spec Book never needed since "there
is only ever one active spec book/bid" (comment, `upload/route.ts` line
146–147) — that single-canonical-key assumption does **not** hold for
Drawing).

**Proposed key, extending STORAGE.md's existing `drawings/` prefix with a
discipline segment to match the real multi-upload-per-bid model:**

```
plan-room/jobs/{bidId}/drawings/{discipline}/original.pdf
```

e.g. `plan-room/jobs/42/drawings/FULLSET/original.pdf`,
`plan-room/jobs/42/drawings/ARCH/original.pdf`. This:
- keeps the same `plan-room/jobs/{bidId}/...` root Spec Book already
  established (one convention, not a second one),
- gives every `(bidId, discipline)` pair its own stable, overwritable key,
  which lines up exactly with the existing re-upload semantics in
  `upload/route.ts` (re-uploading a discipline `deleteMany`s only that
  discipline's row and replaces it — line 98–104),
- and needs no new `DrawingSheet`-level key, per §3.

**Caution, not yet built:** STORAGE.md's diagram also shows `pages/` and
`thumbnails/` under `drawings/`. Nothing in the current code produces or
persists per-page images or thumbnails anywhere —
`drawing_intelligence.py:_render_pages()` rasterizes pages to base64 PNG
**in-memory only**, sends them straight to Claude, and never writes them to
disk. A migration brief should not assume those sub-paths are real artifacts
to move; they are aspirational entries in an already-existing diagram, not
current state. If a future feature actually persists rendered pages/thumbnails,
that's a separate, later decision, not part of this migration.

## 6. Tests a real implementation would need

Mirroring the exact coverage shape Spec Book's `e5d50b0` shipped (file names
and test titles below are taken directly from the current, real Spec Book
test suite as the concrete template):

**Upload** (analog of `specbook/upload/__tests__/route.test.ts`, plus one
Drawing-specific case Spec Book didn't need):
- "upload persists to the correct BlobStore key
  (`plan-room/jobs/{bidId}/drawings/{discipline}/original.pdf`), never
  `uploads/drawings/...`"
- "re-uploading the same discipline overwrites only that discipline's key and
  DB row, leaving sibling-discipline keys untouched" (Drawing-specific — Spec
  Book only ever has one key per bid, so this scenario doesn't exist there)
- "uploading FULLSET replaces all per-discipline keys for the bid" (mirrors
  the existing `deleteMany({ where: { bidId } })` branch, line 99)

**Delete** (analog of `specbook/[uploadId]/__tests__/route.test.ts`):
- "deletes exactly the known BlobStore key for this drawing upload"
- "does not touch a sibling discipline's key under the same bid prefix" —
  the Drawing-specific sharpening of Spec Book's "does not touch unrelated
  keys under the same bid prefix" test, since Drawing's multi-upload-per-bid
  model makes this a real adjacent-key risk in a way Spec Book's
  one-key-per-bid model never had to guard against
- "legacy absolute paths are unlinked directly, not through BlobStore"
- "a corrupted/traversal-like stored key is rejected, not unlinked as an
  arbitrary path"
- "drawing upload not found under this bid returns the existing 404"

**Analyze** (analog of `specbook/split/__tests__/route.test.ts`, since that's
Spec Book's other path-based sidecar handoff):
- "derives a real `/storage` path for the sidecar handoff via
  `localPathForKey()`, never a bare relative key passed as `file_path`"
- "legacy absolute `filePath` is passed through to the sidecar as-is"
- "404/error surfaces when the resolved file is missing from BlobStore,
  without ever calling the sidecar" (mirrors "404s without calling the
  sidecar when the source blob is missing")
- "sidecar failure returns the existing 422/502 error shape, no
  `analysisJson` persisted"

**Availability / missing-file state** (new concept for Drawing, since no
serve route exists yet to model this on):
- "a `DrawingUpload` whose blob is missing (deleted out-of-band, or a broken
  legacy path) surfaces a controlled 'unavailable' state through `gaps`
  and/or a future serve route, rather than throwing or 500ing"

**If a serve route is added** (closing the §1 gap; analog of
`specbook/sections/[sectionId]/pdf/__tests__/route.test.ts`):
- "serves BlobStore content for a new-format relative key"
- "falls back to a direct read for a legacy absolute path"
- "a traversal-like stored key cannot escape the storage root"
- "a stored absolute path outside both BlobStore and the legacy root is
  rejected, not read directly"

**Sidecar-side:** no new Python test coverage is required by this migration.
`analyze_drawings`/`drawing_intelligence.py` keep receiving whatever absolute
path the TS route resolves and stay fully BlobStore-unaware — the same
division of responsibility ADR 0001 already establishes for credentials
(resolution happens once, TS-side; the sidecar is a stateless recipient).
`drawings/split`'s temp-file handoff (§2) is untouched by this migration and
needs no new tests either.

## 7. Overlap assessment against the promotion-blocked `lib/storage/blobStore.ts`

Per the deployed-topology record (`deployed-topology-2026-07` memory,
verified via `docker ps`/`docker compose ls` 2026-07-03): production
(`feat/storage-auth-job-dedupe`, commit `d259b58`) diverged from the effective
mainline at `4137ae5` and carries **7 unique stabilization commits including
an independent "BlobStore refactor"** that has not yet been reconciled with
mainline — this is the promotion-blocked state referenced in this task.

`lib/storage/blobStore.ts` as it exists on this branch is compact (159 lines):
a `BlobStore` interface, `LocalBlobStore` (put/get/stat/exists/delete +
`localPath`), the `getBlobStore()` singleton, `localPathForKey()`, and one
convenience key-builder (`marketDocKey`). The Spec Book migration
(`e5d50b0`) already added 25 lines to this exact file (the `localPath` method
and `localPathForKey` helper) — meaning this file has *already* been a target
of independent, sequential additions on this line before Drawing would touch
it a second time.

A Drawing migration, following this brief, would need to append one more
small, analogous convenience helper (e.g. a `drawingKey(bidId, discipline)`
builder, parallel to `marketDocKey`) to the same file — not a structural
rewrite, an append near the bottom. I cannot read production's actual
`blobStore.ts` diff from this worktree (it isn't checked out here), so I
cannot confirm line-for-line whether prod's independent "BlobStore refactor"
also touched this same bottom convenience-helper region. But the shape of
risk is clear either way: **two independently-evolving branches both
appending new small helpers to the tail of the same file is exactly the kind
of change that collides at merge time**, even when neither change is
individually complex — and this file is already the *named* source of the
current promotion block, so any further un-reconciled addition to it can only
grow, not shrink, that reconciliation's eventual surface.

**Conclusion:** a Drawing migration is not automatically the same conflict as
today's block — it's a different, additive change to a file that happens to
already be under independent unreconciled evolution elsewhere. But sequencing
a second unresolved change into an already-flagged-conflicted file, before
the first conflict is even resolved, is straightforwardly worse process than
waiting. **Recommendation: do not add any Drawing-specific code to
`lib/storage/blobStore.ts` until production's BlobStore refactor is
reconciled with mainline.** Everything else this brief proposes (route-level
changes to the four Drawing routes, Prisma-level reuse of existing fields,
tests) has no dependency on `blobStore.ts`'s internals changing and could in
principle proceed once staging validation (§8) clears — only the one new
helper function needs to wait on the production reconciliation specifically.

## 8. What must wait for human staging validation of the Spec Book pattern

Drawing would inherit the identical `BlobStore` + legacy-path-compatibility
pattern Spec Book just shipped in `e5d50b0` — same key-namespace strategy,
same `isLegacyUploadPath`-shaped fallback, same "sidecar gets a resolved
absolute path, never a bare key" handoff discipline. That pattern is
implemented and unit-tested (§6's Spec Book analogs all exist and presumably
pass), but **nothing in this repository documents that a human has actually
exercised the real end-to-end flow on staging** — upload → split → serve →
delete → re-upload — against the real `LocalBlobStore` backed by the real
`/opt/neuroglitch/storage` bind mount, the real shared sidecar container
mount, and the real legacy-row coexistence. (Searched
`docs/architecture/*.md` and `runtime/runbooks/` for any staging-validation
checklist or sign-off record for this specific flow — none exists yet; the
one runbook present, `runtime/runbooks/staging-backup-restore.md`, covers
backup/restore, not this.)

Until a human runs that manual staging validation and confirms it end-to-end
(especially: does a legacy-path row uploaded before the migration still
split/serve/delete correctly once new-format rows coexist alongside it; does
the sidecar's shared-mount assumption actually hold in the real staging
container topology, not just in unit-test mocks of `localPathForKey`), the
same pattern applied to a second module (Drawing) would be building on an
**unproven-in-the-real-environment** foundation — the code could look
identical to Spec Book's and still fail for an environment-specific reason no
unit test would catch (e.g., the staging fragility already on record: staging's
`docker compose` config references a file that "no longer exists on disk" per
the deployed-topology memory — exactly the kind of real-environment gap that
only surfaces during manual validation, never in `vitest`).

**Recommendation:** treat the Spec Book manual staging validation as a hard
gate before writing any Drawing migration code — not just before merging it.
This brief's existence doesn't change that; it only means the Drawing
implementation session, whenever it happens, doesn't have to re-derive the
plan from scratch.

---

## Summary for implementers

1. Change `DrawingUpload.filePath`'s *meaning* from absolute fs path to
   BlobStore key (`plan-room/jobs/{bidId}/drawings/{discipline}/original.pdf`),
   exactly as `SpecBook.filePath` already changed.
2. Add `isLegacyDrawingPath()` (new root: `uploads/drawings`) to
   `upload`/`[uploadId]`/`analyze` routes, same shape as Spec Book's three
   copies of `isLegacyUploadPath()`.
3. Keep `drawings/split`'s stateless multipart handoff to the sidecar
   completely untouched — it has no persisted artifact and is out of scope.
4. Do not touch `DrawingSheet` — no per-row artifact exists to migrate.
5. Do not add the new `drawingKey()` helper to `lib/storage/blobStore.ts`
   until production's independent BlobStore refactor is reconciled with
   mainline (§7).
6. Do not start writing this code at all until a human has run and confirmed
   the Spec Book upload → split → serve → delete → re-upload staging
   validation end-to-end (§8).
