// Spec Book / Spec Section file availability detection.
//
// SpecBook.filePath and SpecSection.pdfPath store either a relative BlobStore
// key (current), a raw absolute filesystem path under the legacy
// uploads/specbooks root, or a production absolute path rooted at the
// current storage root (see lib/services/specbook/storagePath.ts for the
// full four-shape breakdown, shared by this module and the Spec Book
// routes). Today the API only reports whether a *reference* exists on the
// row (e.g. `pdfPath !== null`) — it never confirms the referenced file is
// actually present in storage, so a missing artifact stays silent until a
// user clicks through and hits a 404. This module closes that gap: given a
// stored reference, it resolves one of four availability states so callers
// can surface "re-upload required" up front instead of on click.
//
// Read-only: this module never writes, deletes, or creates storage state.
// It only calls the shared storagePath resolver's read-only helpers.

import { resolveLocalPath } from "./storagePath";

export type FileAvailability =
  | "durable-present" // valid BlobStore key (or converted production path) that resolves to an existing blob
  | "legacy-present" // recognized legacy filesystem path that exists on disk
  | "missing" // well-formed reference, but nothing found at it
  | "invalid"; // malformed/unrecognized reference (traversal, null bytes, stray absolute path, etc.) — never treated as present

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

  const resolved = await resolveLocalPath(ref);
  if (!resolved.ok) return resolved.reason; // "missing" | "invalid"
  return resolved.kind === "legacy-cwd" ? "legacy-present" : "durable-present";
}

/** True for any state that means the file can actually be opened/served. */
export function isAvailable(state: FileAvailability): boolean {
  return state === "durable-present" || state === "legacy-present";
}
