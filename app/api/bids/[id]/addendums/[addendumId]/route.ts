import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { triggerBriefRefresh } from "@/lib/services/jobs/briefRefreshAutomation";
import { documentAutomationStatus } from "@/lib/services/settings/documentAutomation";
import { readAddendumStorageBuffer } from "@/lib/services/addendums/storagePath";
import { deleteAddendumStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";
import { env } from "@/lib/env";
// isAdminAuthorized (lib/auth.ts) is imported dynamically below, only inside
// the storage-smoke gate branch — lib/auth.ts pulls in the full next-auth
// module graph, and the overwhelming majority of requests never send the
// smoke marker header, so deferring the import keeps their cost identical
// to before this feature existed.

// ── Storage-only smoke mode (work package: storage-smoke-isolation) ────────
//
// This DELETE route unconditionally fired triggerBriefRefresh — a real,
// provider-bound (Claude-calling) job — which made any external smoke
// helper's self-cleanup step fire a real provider call as a side effect.
// The gate below lets an operator's storage-smoke run suppress exactly that
// one call, with semantics IDENTICAL to the upload gates at
// app/api/bids/[id]/specbook/upload/route.ts and
// app/api/bids/[id]/drawings/upload/route.ts (see those modules' docs for
// the full rationale) — only the marker header name differs (domain-scoped).
//
// Fail-closed contract: if the marker header (b) is ABSENT, this route
// behaves exactly as it did before this feature existed — the delete
// proceeds and the brief refresh fires unconditionally, no extra check is
// even performed (byte-identical default path, including the response). But
// if the marker header IS present, this is treated as an EXPLICIT
// storage-smoke attempt — and if any of the other three conditions (a/c/d)
// is not also true, the request is REJECTED outright (a controlled, non-2xx
// response, before the row lookup, before the delete, before any blob
// cleanup) rather than silently falling through to a normal delete whose
// side effect is a real provider call.
//
//   a. Authenticated ADMIN session (lib/auth.ts's isAdminAuthorized()).
//   b. The caller sent the non-secret intent marker header below.
//   c. STORAGE_SMOKE_MODE_ENABLED=true in the server's own process env.
//      Defaults OFF/unset.
//   d. env.APP_ENV === "staging" — a server-side identity fact, never
//      derived from any part of an incoming request.
//
// When suppression engages, the response gains an ADDITIVE header
// `X-Automation-Status: suppressed_for_storage_smoke` (the body's success
// shape is unchanged). The header is only ever set on the suppressed path —
// the default path's response stays byte-identical to before this feature.
//
// The marker header value itself is never persisted (no DB row, no log
// line) — it is read once into a boolean and discarded.
const STORAGE_SMOKE_HEADER = "x-addendums-storage-smoke";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; addendumId: string }> },
) {
  const { id, addendumId } = await params;
  const bidId = parseInt(id, 10);
  const aId = parseInt(addendumId, 10);
  if (isNaN(bidId) || isNaN(aId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const record = await prisma.addendumUpload.findFirst({
    where: { id: aId, bidId },
    select: { fileName: true, storageKey: true },
  });
  if (!record) return Response.json({ error: "Not found" }, { status: 404 });
  if (!record.storageKey) {
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readAddendumStorageBuffer(record.storageKey, bidId);
  } catch {
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }
  return new Response(new Uint8Array(buffer), {
    headers: privateDownloadHeaders({
      mimeType: "application/pdf",
      fileName: record.fileName,
      byteSize: buffer.byteLength,
    }),
  });
}

// ── Master document-automation gate (Q03.2b: Admin-controlled) — IDENTICAL
// semantics to the specbook/drawings upload routes (see those modules'
// docs): gated by the GLOBAL persisted Admin setting via
// documentAutomationStatus() (default OFF; DOCUMENT_AUTOMATION_HARD_DISABLED
// emergency lock always wins; legacy env var read nowhere). Independent of,
// and subordinate to, the 4-condition storage-smoke gate above:
// `suppressed_for_storage_smoke` always wins.
//
// This route surfaces automation state via an ADDITIVE `X-Automation-Status`
// response header rather than a body field (see the suppressed-path doc
// above) — the "disabled"/"hard_disabled" states follow that same
// convention. The default path's body stays byte-identical
// (`{ deleted: true }`); only the header is added when automation does not
// fire.

// DELETE /api/bids/[id]/addendums/[addendumId]
// Deletes the addendum record, marks brief stale, fires regeneration, and
// best-effort cleans up the durable blob if this row has a storageKey.
// Historic rows (written before the storageKey column existed) have no
// on-disk reference at all — a null storageKey is a safe no-op, never a
// guessed path.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  const { id, addendumId } = await params;
  const bidId = parseInt(id, 10);
  const aId = parseInt(addendumId, 10);
  if (isNaN(bidId) || isNaN(aId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  // ── Storage-only smoke gate — see module doc above for the full
  // 4-condition contract. Checked FIRST, before any read/write below.
  // Cheapest, non-auth checks first, so the default (no marker header)
  // request path pays for nothing beyond a single header read.
  const storageSmokeRequested = request.headers.get(STORAGE_SMOKE_HEADER) === "1";
  let suppressAutomationForStorageSmoke = false;

  if (storageSmokeRequested) {
    if (env.APP_ENV !== "staging") {
      return Response.json(
        { error: "Storage-only smoke mode is only permitted on the staging environment" },
        { status: 403 }
      );
    }
    if (process.env.STORAGE_SMOKE_MODE_ENABLED !== "true") {
      return Response.json(
        { error: "Storage-only smoke mode is not enabled on this server" },
        { status: 403 }
      );
    }
    const { isAdminAuthorized } = await import("@/lib/auth");
    const adminCheck = await isAdminAuthorized();
    if (!adminCheck.authorized) {
      return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
    }
    // ALL FOUR conditions hold — proceed with the normal delete mechanics
    // below, but suppress the provider-bound brief refresh.
    suppressAutomationForStorageSmoke = true;
  }

  const record = await prisma.addendumUpload.findFirst({
    where: { id: aId, bidId },
    select: { id: true, storageKey: true },
  });
  if (!record) {
    return Response.json({ error: "Addendum not found" }, { status: 404 });
  }

  await prisma.addendumUpload.delete({ where: { id: aId } });

  // Clean up the durable blob (best-effort — a missing/invalid/null key is
  // a no-op, never an error that blocks the delete).
  if (record.storageKey) {
    await deleteAddendumStorageIfUnreferenced(record.storageKey, bidId).catch((err) => {
      console.error("[addendums/delete] unreferenced blob cleanup failed:", err);
    });
  }

  // Mark brief stale and regenerate
  await prisma.bidIntelligenceBrief.updateMany({
    where: { bidId },
    data: { isStale: true },
  });

  // The 4-condition storage-smoke gate at the top of this handler already
  // decided suppression (or rejected the request outright, before any
  // persistence, if the marker was present but any condition failed) — by
  // the time execution reaches here, either no marker was sent, or all four
  // conditions held. Nothing to re-check.
  if (suppressAutomationForStorageSmoke) {
    // Additive signal only on the suppressed path — the default path's
    // response below stays byte-identical to before this feature existed.
    return Response.json(
      { deleted: true },
      { headers: { "X-Automation-Status": "suppressed_for_storage_smoke" } }
    );
  }

  // Storage-smoke suppression does not apply — the Admin setting (with the
  // emergency hard-disable lock above it) decides whether the real,
  // provider-bound brief refresh fires. See the gate doc above.
  const automationStatus = await documentAutomationStatus();
  if (automationStatus !== "triggered") {
    return Response.json(
      { deleted: true },
      { headers: { "X-Automation-Status": automationStatus } }
    );
  }

  triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
    console.error("[addendums/delete] background brief refresh failed:", err)
  );

  return Response.json({ deleted: true });
}
