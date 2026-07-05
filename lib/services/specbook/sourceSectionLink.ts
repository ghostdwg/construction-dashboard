// "View source section" action resolution.
//
// Some models have a genuine, schema-backed foreign key pointing at a real
// SpecSection row (today: SubmittalItem.specSectionId — see Phase 5G-1/5B).
// For those rows, the UI can safely link back to the existing section-PDF
// serving route (app/api/bids/[id]/specbook/sections/[sectionId]/pdf) instead
// of leaving the AI-derived item's provenance implicit.
//
// This module is intentionally pure and read-only: it never touches Prisma,
// BlobStore, or the filesystem. Callers resolve the target section's file
// availability themselves (via checkFileAvailability(), same as the existing
// Phase 3 gaps-route/DocumentsTab work) and pass the already-resolved
// FileAvailability in here — this module only decides what to render from
// that, and builds the route path from validated numeric IDs.
//
// Do NOT extend this to build links from free-text matching (e.g. regexing a
// CSI number out of AI output). It must only ever be called with an ID that
// came from a populated, schema-declared foreign key column.
//
// Deliberately a type-only import of FileAvailability below (not a value
// import of anything from fileAvailability.ts): that module's runtime code
// pulls in "fs/promises" and BlobStore, which are Node-only. This module is
// imported from client components (SubmittalsTab.tsx), so it must stay free
// of any runtime dependency that can't be bundled for the browser.

import type { FileAvailability } from "./fileAvailability";

function isAvailable(state: FileAvailability): boolean {
  return state === "durable-present" || state === "legacy-present";
}

export type SourceSectionAction =
  | { kind: "link"; href: string }
  | {
      kind: "unavailable";
      state: Exclude<FileAvailability, "durable-present" | "legacy-present">;
    };

/**
 * Builds the path to the existing section-PDF serving route.
 *
 * Both arguments must be positive integers — the DB-sourced bid id and
 * SpecSection id, never a raw string or anything derived from free text.
 * Throws rather than silently coercing, so a caller that accidentally passes
 * an unchecked value fails loudly instead of constructing a malformed path.
 */
export function buildSourceSectionHref(bidId: number, specSectionId: number): string {
  if (!Number.isInteger(bidId) || bidId <= 0) {
    throw new Error(`buildSourceSectionHref: invalid bidId (${JSON.stringify(bidId)})`);
  }
  if (!Number.isInteger(specSectionId) || specSectionId <= 0) {
    throw new Error(
      `buildSourceSectionHref: invalid specSectionId (${JSON.stringify(specSectionId)})`
    );
  }
  return `/api/bids/${bidId}/specbook/sections/${specSectionId}/pdf`;
}

/**
 * Decides whether/how to render a "View source section" action for a row
 * that may carry a specSectionId.
 *
 * Returns `null` when there is no relationship to show at all (specSectionId
 * is null/undefined) — callers must render nothing in that case, not a
 * disabled placeholder. Returns `{ kind: "unavailable", ... }` when the
 * relationship exists but the target file isn't currently servable, so the
 * caller can render the same honest "re-upload required" treatment used
 * elsewhere in Spec Book. Returns `{ kind: "link", href }` otherwise.
 */
export function resolveSourceSectionAction(
  bidId: number,
  specSectionId: number | null | undefined,
  availability: FileAvailability | null | undefined
): SourceSectionAction | null {
  if (specSectionId === null || specSectionId === undefined) return null;

  if (availability != null && !isAvailable(availability)) {
    return {
      kind: "unavailable",
      state: availability as Exclude<FileAvailability, "durable-present" | "legacy-present">,
    };
  }

  return { kind: "link", href: buildSourceSectionHref(bidId, specSectionId) };
}
