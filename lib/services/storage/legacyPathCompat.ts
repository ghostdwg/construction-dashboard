// Shared, domain-parameterized storage-path compatibility factory.
//
// lib/services/specbook/storagePath.ts (see its own header comment) solved
// this exact problem for Spec Books: a DB column (`SpecBook.filePath` /
// `SpecSection.pdfPath`) that can hold one of four shapes —
//   1. "canonical"           — a relative BlobStore key (current convention)
//   2. "legacy-cwd"          — a pre-BlobStore absolute path rooted at
//                              process.cwd()/uploads/{domain}
//   3. "legacy-storage-root" — the exact production absolute-path shape
//                              rooted at the *current* storage root
//                              ({root}/uploads/{domain}/{scope...}/<rest>),
//                              bid/record-scoped so a corrupted reference
//                              pointing at a *different* record's artifact
//                              (or an unrelated namespace) is never accepted
//   4. "invalid"             — anything else (unrecognized absolute path,
//                              traversal, null byte, backslash-leading,
//                              empty, or a storage-root path that doesn't
//                              structurally match shape 3, including a
//                              scope mismatch)
//
// Drawings, Estimates, Addendums, and Meetings each need the identical
// classify/resolve/read/delete behavior, but MUST NOT share Spec Book's own
// module — that module is intentionally scoped to Spec Book's own namespace
// (`uploads/specbooks/{bidId}/...`) and hard-codes that shape. Widening it
// into a generic classifier for unrelated domains would let a corrupted
// Drawings row get classified using Spec Book's namespace/shape rules (or
// vice versa) — exactly the cross-domain confusion this whole design avoids.
//
// This module is the shared SHAPE (mirroring storagePath.ts's design)
// instantiated independently per domain via createLegacyPathCompat(): each
// call site gets its own closures over its own legacyCwdRoot and
// legacyStorageRootSegments, so a Drawings-shaped path is structurally
// unrecognizable to the Estimates instance and vice versa — there is no
// shared mutable state and no shared recognized-shape list between domains.
//
// Scope generalization: Spec Book's shape is scoped by a single bidId
// segment. Estimates' on-disk convention is scoped by TWO segments
// (`{bidId}/{subcontractorId}`). Rather than special-case that, every
// instance's classify/resolve/read/delete functions take a `scope:
// Array<string | number>` — the ordered list of segments that must appear,
// in order, immediately after the domain's legacyStorageRootSegments for a
// legacy-storage-root match. A single-bidId domain passes `[bidId]`;
// Estimates passes `[bidId, subcontractorId]`. Each domain's own thin
// wrapper module (e.g. lib/services/drawings/storagePath.ts) hides this
// array behind a domain-appropriate named-parameter signature so callers
// never have to think about the generalization.

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

export type ScopeSegment = string | number;

export type LegacyPathCompatConfig = {
  /**
   * Path segments identifying this domain's pre-BlobStore legacy root under
   * process.cwd(), e.g. ["uploads", "drawings"] for
   * process.cwd()/uploads/drawings.
   */
  legacyCwdSegments: string[];
  /**
   * Path segments identifying this domain's production absolute-path
   * namespace under the storage root, e.g. ["uploads", "drawings"] for
   * {STORAGE_LOCAL_PATH}/uploads/drawings/{scope...}/<rest>. Kept as a
   * separate config key from legacyCwdSegments even though every current
   * domain uses the same segments for both — nothing requires them to
   * match, and a future domain might genuinely differ.
   */
  legacyStorageRootSegments: string[];
};

export type LegacyPathCompat = {
  /** Pure classification — never touches the filesystem or BlobStore. */
  classify(ref: string, scope: ScopeSegment[]): ClassifyResult;
  /** Resolve a stored reference to a real local absolute path, checking existence. */
  resolveLocalPath(ref: string, scope: ScopeSegment[]): Promise<ResolvedLocalPath>;
  /** True iff the reference resolves to a real, existing local file. */
  storagePathExists(ref: string, scope: ScopeSegment[]): Promise<boolean>;
  /** Read a stored reference's bytes. Throws on "missing" or "invalid". */
  readBuffer(ref: string, scope: ScopeSegment[]): Promise<Buffer>;
  /** Delete a stored reference's underlying file, best-effort. No-op if invalid. */
  deletePath(ref: string, scope: ScopeSegment[]): Promise<void>;
};

// Reject path-traversal attempts, null bytes, and backslash-leading values
// BEFORE any shape recognition runs — mirrors
// lib/services/specbook/storagePath.ts's looksMalformedOrUnsafe() exactly,
// so a traversal attempt embedded inside something that superficially looks
// like either legacy shape is still rejected as invalid.
function looksMalformedOrUnsafe(ref: string): boolean {
  if (!ref) return true;
  if (ref.includes("\0")) return true;
  if (ref.startsWith("\\") || ref.startsWith("\\\\")) return true;
  if (/(^|[/\\])\.\.([/\\]|$)/.test(ref)) return true;
  return false;
}

// Read fresh on every call — never cached at module scope — so tests (and a
// running process whose env changes between requests) always see the
// current value. Mirrors getBlobStore()'s own STORAGE_LOCAL_PATH default.
function getStorageRoot(): string {
  return process.env.STORAGE_LOCAL_PATH || "/storage";
}

// Returns the derived relative key iff `p` is a real, separator-bounded
// descendant of the current storage root — never a bare substring match.
function deriveStorageRootRelativeKey(p: string): string | null {
  const root = path.resolve(getStorageRoot());
  const resolved = path.resolve(p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  const rel = path.relative(root, resolved);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

// Structural match for a domain's one production-emitted absolute-path
// shape: {legacyStorageRootSegments...}/{scope...}/<one or more further
// segments>. Every scope segment must equal the caller-supplied expected
// value exactly (string form) — a syntactically-plausible relative key under
// the storage root that names a different record (wrong bidId, wrong
// subcontractorId, ...), or a different top-level namespace entirely, or has
// no further segments beyond the scope, is rejected here.
function matchesProductionShape(
  relKey: string,
  scope: ScopeSegment[],
  rootSegments: string[]
): boolean {
  const expected = [...rootSegments, ...scope.map(String)];
  const segments = relKey.split("/");
  if (segments.length <= expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (segments[i] !== expected[i]) return false;
  }
  return segments.slice(expected.length).every((s) => s.length > 0);
}

/**
 * Instantiate an independently-scoped classify/resolve/read/delete set for
 * one domain. Each call produces fresh closures over its own
 * legacyCwdRoot/legacyStorageRootSegments — there is no shared state between
 * domains, so a Drawings-shaped reference can never be misclassified by the
 * Estimates instance (or vice versa).
 */
export function createLegacyPathCompat(config: LegacyPathCompatConfig): LegacyPathCompat {
  const legacyCwdRoot = path.join(process.cwd(), ...config.legacyCwdSegments);

  function isLegacyCwdPath(p: string): boolean {
    return (
      path.isAbsolute(p) &&
      (p === legacyCwdRoot || p.startsWith(legacyCwdRoot + path.sep))
    );
  }

  function classify(ref: string, scope: ScopeSegment[]): ClassifyResult {
    if (looksMalformedOrUnsafe(ref)) return { kind: "invalid" };

    if (!path.isAbsolute(ref)) {
      // A relative value that passed the malformed/unsafe check above is a
      // canonical BlobStore key candidate — final validation happens where
      // BlobStore itself enforces it (assertSafeKey).
      return { kind: "canonical", canonicalKey: ref };
    }

    if (isLegacyCwdPath(ref)) return { kind: "legacy-cwd" };

    const relKey = deriveStorageRootRelativeKey(ref);
    if (relKey && matchesProductionShape(relKey, scope, config.legacyStorageRootSegments)) {
      return { kind: "legacy-storage-root", canonicalKey: relKey };
    }

    return { kind: "invalid" };
  }

  async function resolveLocalPath(ref: string, scope: ScopeSegment[]): Promise<ResolvedLocalPath> {
    const classified = classify(ref, scope);

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

  async function storagePathExists(ref: string, scope: ScopeSegment[]): Promise<boolean> {
    return (await resolveLocalPath(ref, scope)).ok;
  }

  async function readBuffer(ref: string, scope: ScopeSegment[]): Promise<Buffer> {
    const classified = classify(ref, scope);
    if (classified.kind === "invalid") {
      throw new Error("legacyPathCompat: invalid or unrecognized storage reference");
    }
    if (classified.kind === "legacy-cwd") {
      return fs.readFile(ref);
    }
    return getBlobStore().get(classified.canonicalKey);
  }

  async function deletePath(ref: string, scope: ScopeSegment[]): Promise<void> {
    const classified = classify(ref, scope);
    if (classified.kind === "invalid") return;
    if (classified.kind === "legacy-cwd") {
      await fs.unlink(ref);
      return;
    }
    await getBlobStore().delete(classified.canonicalKey);
  }

  return { classify, resolveLocalPath, storagePathExists, readBuffer, deletePath };
}
