// Spec Book / Spec Section file availability detection.
//
// SpecBook.filePath and SpecSection.pdfPath store either a relative BlobStore
// key (current) or, for pre-migration rows, a raw absolute filesystem path
// under the legacy uploads/specbooks root (see upload/route.ts and
// split/route.ts). Today the API only reports whether a *reference* exists
// on the row (e.g. `pdfPath !== null`) — it never confirms the referenced
// file is actually present in storage, so a missing artifact stays silent
// until a user clicks through and hits a 404. This module closes that gap:
// given a stored reference, it resolves one of four availability states so
// callers can surface "re-upload required" up front instead of on click.
//
// Read-only: this module never writes, deletes, or creates storage state.
// It only calls BlobStore's existing public read methods (exists()) and,
// for the one recognized legacy path shape, fs.access — mirroring the same
// legacy-path recognition already duplicated across the Spec Book routes.

import path from "path";
import fs from "fs/promises";
import { getBlobStore } from "@/lib/storage/blobStore";

export type FileAvailability =
  | "durable-present" // valid BlobStore key that resolves to an existing blob
  | "legacy-present" // recognized legacy filesystem path that exists on disk
  | "missing" // well-formed reference, but nothing found at it
  | "invalid"; // malformed/unrecognized reference (traversal, null bytes, stray absolute path, etc.) — never treated as present

// Pre-migration records may still hold a raw filesystem path from before
// Spec Book storage moved to BlobStore. Recognizing this one known historic
// shape lets availability detection work for those rows without a data
// migration — anything else absolute is treated as untrusted, never as a
// legacy path to read directly. Matches the constant duplicated in the
// existing Spec Book routes (upload/split/serve/delete).
const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "specbooks");

function isLegacyUploadPath(p: string): boolean {
  return (
    path.isAbsolute(p) &&
    (p === LEGACY_UPLOAD_ROOT || p.startsWith(LEGACY_UPLOAD_ROOT + path.sep))
  );
}

// Reject anything that looks like a path-traversal attempt, a null byte, or
// an absolute path outside the one recognized legacy root — before we ever
// touch BlobStore or the filesystem with it. This is intentionally stricter
// than "let BlobStore's own key validation catch it": BlobStore.exists()
// swallows its internal validation errors and returns false, which would
// otherwise be indistinguishable from a merely-missing file.
function looksMalformedOrUnsafe(ref: string): boolean {
  if (!ref) return true;
  if (ref.includes("\0")) return true;
  if (ref.startsWith("\\") || ref.startsWith("\\\\")) return true;
  if (/(^|[/\\])\.\.([/\\]|$)/.test(ref)) return true;
  if (path.isAbsolute(ref) && !isLegacyUploadPath(ref)) return true;
  return false;
}

/**
 * Resolve the availability of a stored Spec Book / Spec Section file
 * reference. `ref` is whatever is currently stored in `filePath` / `pdfPath`
 * — a relative BlobStore key, a legacy absolute path, or (rarely) a
 * corrupted/unexpected value.
 *
 * Pass `null`/`undefined`/empty string only when there is genuinely no
 * reference to check (e.g. a section that hasn't been split yet) — this
 * resolves to "missing" like any other absent file, since the caller is
 * responsible for distinguishing "no reference recorded" from "referenced
 * but not split yet" at a higher level if that distinction matters to it.
 */
export async function checkFileAvailability(
  ref: string | null | undefined
): Promise<FileAvailability> {
  if (ref === null || ref === undefined || ref === "") return "missing";
  if (looksMalformedOrUnsafe(ref)) return "invalid";

  if (isLegacyUploadPath(ref)) {
    try {
      await fs.access(ref);
      return "legacy-present";
    } catch {
      return "missing";
    }
  }

  try {
    const exists = await getBlobStore().exists(ref);
    return exists ? "durable-present" : "missing";
  } catch {
    // BlobStore's own key validation (assertSafeKey) rejects some shapes
    // (leading slash, `..`, etc.) by throwing rather than returning false.
    // Our pre-check above already screens out the common cases, but treat
    // any surprise rejection the same way: never "present".
    return "invalid";
  }
}

/** True for any state that means the file can actually be opened/served. */
export function isAvailable(state: FileAvailability): boolean {
  return state === "durable-present" || state === "legacy-present";
}
