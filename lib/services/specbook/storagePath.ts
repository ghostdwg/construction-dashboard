// Spec Book / Spec Section storage-path compatibility classifier + resolvers.
//
// SpecBook.filePath and SpecSection.pdfPath can hold one of four shapes today
// (see docs/architecture/prod-blobstore-reconciliation-dossier.md §4 and §10
// bucket (b) for the full history of how this happened):
//
//   1. "canonical"           — a relative BlobStore key, e.g.
//                              "plan-room/jobs/{bidId}/spec/original.pdf".
//                              The current, correct convention.
//   2. "legacy-cwd"           — a pre-BlobStore absolute path rooted at
//                              path.join(process.cwd(), "uploads", "specbooks"),
//                              from rows written before BlobStore existed.
//   3. "legacy-storage-root"  — the exact production absolute path shape
//                              rooted at the *current* storage root itself
//                              (STORAGE_LOCAL_PATH, default "/storage"):
//                                {root}/uploads/specbooks/{bidId}/<rest>
//                              where {bidId} must equal the caller-supplied
//                              expected bid id (see below) and <rest> is one
//                              or more further path segments. This is the
//                              one and only absolute-path shape production
//                              actually ever writes to SpecBook.filePath /
//                              SpecSection.pdfPath (verified against the
//                              upload route's key-building and the sidecar
//                              splitter's output-naming convention) —
//                              anything else under the storage root (a
//                              mismatched bid id, a different top-level
//                              namespace, a bare file at the root,
//                              `uploads/<not-specbooks>/...`) is "invalid",
//                              not this shape. Stripping the root prefix
//                              yields a valid, already-on-disk BlobStore
//                              relative key — this shape lives under the
//                              exact same physical root
//                              getBlobStore()/localPathForKey() already
//                              manage, just addressed absolutely.
//   4. "invalid"              — anything else: an unrecognized absolute path,
//                              a path-traversal attempt, a null byte, a
//                              backslash-leading value, empty, or an absolute
//                              storage-root path that doesn't structurally
//                              match shape 3 above (including a mismatched
//                              bid id segment).
//
// This module was previously duplicated near-identically (recognizing only
// shapes 1/2/4, treating shape 3 as invalid) across:
//   - lib/services/specbook/fileAvailability.ts
//   - app/api/bids/[id]/specbook/split/route.ts
//   - app/api/bids/[id]/specbook/sections/[sectionId]/pdf/route.ts
//   - app/api/bids/[id]/specbook/[uploadId]/route.ts
// All four now import from here instead of keeping their own copy.
//
// Every export below takes a required `bidId: number` — the bid id the
// caller already validated the record (SpecBook/SpecSection) against (e.g.
// via a `where: { id, bidId }` Prisma query, or a route's own already-parsed
// path param). This makes bid-scoping structurally mandatory: shape 3 above
// cannot be recognized at all without naming the bid it's expected to belong
// to, closing the gap where a corrupted filePath/pdfPath pointing at some
// *other* file under the shared storage mount (a different bid's artifact,
// or an unrelated top-level namespace like "market/docs/...") would
// otherwise be treated as a legitimate, deletable/readable BlobStore
// reference. Canonical (relative key) and legacy-cwd shapes don't use the
// value at all — bid-scoping is a no-op for them by design (a relative
// BlobStore key has no bidId-segment convention to structurally enforce
// here, and the legacy-cwd shape's existing vetted behavior is left as-is
// per the task that introduced this constraint) — but the parameter is
// still required so a caller can never accidentally omit it for the one
// shape that does need it.
//
// `classifyStoragePath()` is a pure function — it never touches the
// filesystem or BlobStore. The resolver helpers below it perform I/O, but
// always dispatch through `classifyStoragePath()` first and never re-derive
// path-join arithmetic independently: canonical/legacy-storage-root keys go
// through getBlobStore()/localPathForKey(); legacy-cwd paths use direct fs
// calls against the raw absolute path (exactly as before); invalid
// references never reach the filesystem or BlobStore at all.

import fs from "fs/promises";
import path from "path";
import { getBlobStore, localPathForKey } from "@/lib/storage/blobStore";

export type StoragePathKind =
  | "canonical"
  | "legacy-cwd"
  | "legacy-storage-root"
  | "invalid";

export type ClassifyResult =
  | { kind: "canonical"; canonicalKey: string }
  | { kind: "legacy-storage-root"; canonicalKey: string }
  | { kind: "legacy-cwd" }
  | { kind: "invalid" };

// The one recognized pre-BlobStore legacy root (see module header). Matches
// the constant formerly duplicated across the four call sites.
const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "specbooks");

function isLegacyCwdPath(p: string): boolean {
  return (
    path.isAbsolute(p) &&
    (p === LEGACY_UPLOAD_ROOT || p.startsWith(LEGACY_UPLOAD_ROOT + path.sep))
  );
}

// Read fresh on every call — never cached at module scope — so tests (and a
// running process whose env changes between requests) always see the
// current value. Mirrors getBlobStore()'s own STORAGE_LOCAL_PATH default.
function getStorageRoot(): string {
  return process.env.STORAGE_LOCAL_PATH || "/storage";
}

// Returns the derived relative key iff `p` is a real, separator-bounded
// descendant of the current storage root — never a bare substring match
// (e.g. root "/data/blobs" must not match "/data/blobs-decoy/...").
// This alone is NOT sufficient to accept the path as the production
// "legacy-storage-root" shape — see matchesProductionSpecbookShape() below,
// which structurally validates the derived key against the one shape
// production actually writes.
function deriveStorageRootRelativeKey(p: string): string | null {
  const root = path.resolve(getStorageRoot());
  const resolved = path.resolve(p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  const rel = path.relative(root, resolved);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

// Structural match for the one production-emitted absolute-path shape:
//   uploads/specbooks/{bidId}/<one or more further segments>
// `{bidId}` must equal the caller-supplied expected bid id exactly (string
// form) — a syntactically-plausible relative key under the storage root
// that names a *different* bid, or a different top-level namespace
// entirely (e.g. "plan-room/...", "market/..."), or has no further segments
// beyond the bid id, is rejected here (the caller classifies it "invalid").
function matchesProductionSpecbookShape(relKey: string, bidId: number): boolean {
  const segments = relKey.split("/");
  return (
    segments.length >= 4 &&
    segments[0] === "uploads" &&
    segments[1] === "specbooks" &&
    segments[2] === String(bidId) &&
    segments.slice(3).every((s) => s.length > 0)
  );
}

// Reject path-traversal attempts, null bytes, and backslash-leading values
// BEFORE any shape recognition runs — exactly mirroring the ordering in
// fileAvailability.ts's (now-removed) local looksMalformedOrUnsafe(), so a
// traversal attempt embedded inside something that superficially looks like
// either legacy shape is still rejected as invalid, never treated as
// legacy-cwd or legacy-storage-root.
function looksMalformedOrUnsafe(ref: string): boolean {
  if (!ref) return true;
  if (ref.includes("\0")) return true;
  if (ref.startsWith("\\") || ref.startsWith("\\\\")) return true;
  if (/(^|[/\\])\.\.([/\\]|$)/.test(ref)) return true;
  return false;
}

/**
 * Pure classification of a stored Spec Book / Spec Section reference. Never
 * touches the filesystem or BlobStore — safe to call with no I/O mocked at
 * all.
 *
 * `bidId` is the bid the caller already validated this reference's owning
 * record against — required for every call, even though only the
 * "legacy-storage-root" shape actually uses it (see module header).
 */
export function classifyStoragePath(ref: string, bidId: number): ClassifyResult {
  if (looksMalformedOrUnsafe(ref)) return { kind: "invalid" };

  if (!path.isAbsolute(ref)) {
    // A relative value that passed the malformed/unsafe check above is a
    // canonical BlobStore key candidate — final validation (length, etc.)
    // happens where BlobStore itself enforces it (assertSafeKey). No
    // bid-scoping check here: a relative key has no bidId-segment
    // convention to structurally enforce.
    return { kind: "canonical", canonicalKey: ref };
  }

  if (isLegacyCwdPath(ref)) return { kind: "legacy-cwd" };

  const relKey = deriveStorageRootRelativeKey(ref);
  if (relKey && matchesProductionSpecbookShape(relKey, bidId)) {
    return { kind: "legacy-storage-root", canonicalKey: relKey };
  }

  return { kind: "invalid" };
}

export type ResolvedLocalPath =
  | {
      ok: true;
      /** Real absolute filesystem path, suitable for fs calls or sidecar handoff. */
      localPath: string;
      kind: Exclude<StoragePathKind, "invalid">;
      /** Present for "canonical" and "legacy-storage-root" only. */
      canonicalKey?: string;
    }
  | { ok: false; reason: "missing" | "invalid" };

/**
 * Resolve a stored reference to a real local absolute path, checking
 * existence along the way. Dispatches on classifyStoragePath():
 *   - "canonical" / "legacy-storage-root": getBlobStore().exists() +
 *     localPathForKey() against the derived canonical key.
 *   - "legacy-cwd": fs.access() + the raw absolute path directly.
 *   - "invalid": never touches the filesystem or BlobStore; reported as a
 *     safe "invalid" result rather than an opaque thrown error (mirrors
 *     checkFileAvailability()'s existing catch-and-classify pattern for a
 *     surprise assertSafeKey throw).
 *
 * `bidId` must be the bid this reference's owning record is already scoped
 * to (see module header) — passed straight through to classifyStoragePath().
 */
export async function resolveLocalPath(ref: string, bidId: number): Promise<ResolvedLocalPath> {
  const classified = classifyStoragePath(ref, bidId);

  if (classified.kind === "invalid") return { ok: false, reason: "invalid" };

  if (classified.kind === "legacy-cwd") {
    try {
      await fs.access(ref);
      return { ok: true, localPath: ref, kind: "legacy-cwd" };
    } catch {
      return { ok: false, reason: "missing" };
    }
  }

  try {
    const exists = await getBlobStore().exists(classified.canonicalKey);
    if (!exists) return { ok: false, reason: "missing" };
    return {
      ok: true,
      localPath: localPathForKey(classified.canonicalKey),
      kind: classified.kind,
      canonicalKey: classified.canonicalKey,
    };
  } catch {
    // BlobStore's own key validation can throw for surprise shapes our
    // pre-check didn't anticipate — never treat that as "present".
    return { ok: false, reason: "invalid" };
  }
}

/** True iff the reference resolves to a real, existing local file. */
export async function storagePathExists(ref: string, bidId: number): Promise<boolean> {
  return (await resolveLocalPath(ref, bidId)).ok;
}

/**
 * Read a stored reference's bytes. Throws (never returns) on "missing" or
 * "invalid" — mirrors BlobStore.get()'s own "throws if missing" contract, so
 * existing callers that wrap this in try/catch keep their current behavior
 * unchanged. An "invalid" reference is rejected before any fs/BlobStore call
 * is made.
 */
export async function readStoragePathBuffer(ref: string, bidId: number): Promise<Buffer> {
  const classified = classifyStoragePath(ref, bidId);
  if (classified.kind === "invalid") {
    throw new Error("storagePath: invalid or unrecognized storage reference");
  }
  if (classified.kind === "legacy-cwd") {
    return fs.readFile(ref);
  }
  return getBlobStore().get(classified.canonicalKey);
}

/**
 * Delete a stored reference's underlying file, best-effort. An "invalid"
 * reference is a silent no-op — never opened as an arbitrary filesystem
 * path. Callers that clean up multiple artifacts should still wrap calls in
 * Promise.allSettled for the legacy-cwd case, where a genuine ENOENT/other
 * fs.unlink error is not swallowed here (matching prior behavior).
 */
export async function deleteStoragePath(ref: string, bidId: number): Promise<void> {
  const classified = classifyStoragePath(ref, bidId);
  if (classified.kind === "invalid") return;
  if (classified.kind === "legacy-cwd") {
    await fs.unlink(ref);
    return;
  }
  await getBlobStore().delete(classified.canonicalKey);
}

function assertImmutableSpecId(immutableId: string): void {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(immutableId)) {
    throw new Error("immutable spec revision id is invalid");
  }
}

/** Collision-safe key for every newly uploaded Spec source revision. */
export function specRevisionStorageKey(
  bidId: number,
  immutableId: string,
  safeFileName: string,
): string {
  assertImmutableSpecId(immutableId);
  return `plan-room/jobs/${bidId}/spec/${immutableId}/${safeFileName}`;
}

/** Immutable directory used by the splitter for one source revision only. */
export function specSectionStoragePrefix(
  bidId: number,
  immutableId: string,
  evidenceRunId: string,
): string {
  assertImmutableSpecId(immutableId);
  assertImmutableSpecId(evidenceRunId);
  return `plan-room/jobs/${bidId}/spec/${immutableId}/sections/${evidenceRunId}`;
}
