import path from "path";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  getBlobStore,
  safeBlobFileName,
  type PutResult,
} from "@/lib/storage/blobStore";
import { parseSpecSections, matchSectionThreeState } from "@/lib/documents/specParser";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";
import { triggerBriefRefresh } from "@/lib/services/jobs/briefRefreshAutomation";
import { documentAutomationStatus } from "@/lib/services/settings/documentAutomation";
import { env } from "@/lib/env";
import { specRevisionStorageKey } from "@/lib/services/specbook/storagePath";
import { deleteSpecStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";
import { appendSectionEvidenceTx } from "@/lib/services/specEvidence/evidence";
// isAdminAuthorized (lib/auth.ts) is imported dynamically below, only inside
// the storage-smoke gate branch — this route is on the hot path for every
// spec book upload, and lib/auth.ts pulls in the full next-auth module graph.
// The overwhelming majority of requests never send the smoke marker header,
// so deferring the import keeps their cost identical to before this feature
// existed (no next-auth module load at all on that path).

// ── Storage-only smoke mode (work package: specbook-storage-smoke-isolation) ─
//
// Lets an operator validate upload/split/serve/delete/re-upload storage
// mechanics on staging WITHOUT triggering a real Anthropic call, while a
// credential rotation is pending. This is NOT a generic "skip AI" switch —
// suppression only ever engages when ALL FOUR of the following hold
// simultaneously.
//
// Fail-closed contract: if the marker header (b) is ABSENT, this route
// behaves exactly as it did before this feature existed — normal automation
// fires unconditionally, no extra check is even performed. But if the marker
// header IS present, this is treated as an EXPLICIT storage-smoke attempt —
// and if any of the other three conditions (a/c/d) is not also true, the
// request is REJECTED outright (a controlled, non-2xx response, before any
// BlobStore write or DB persistence) rather than silently falling through to
// normal automation. A caller that goes out of its way to send the marker
// header must never be able to trigger a real provider call by getting one
// of the other three conditions wrong — that would be the worst possible
// failure mode for a feature whose entire purpose is avoiding real provider
// calls during a credential rotation.
//
//   a. Authenticated ADMIN session (reuses lib/auth.ts's isAdminAuthorized(),
//      in addition to the route's parent-Bid access guard).
//   b. The caller sent the non-secret intent marker header below. Non-secret
//      because it grants no authority by itself — it is intent, not
//      authorization. The other three conditions are what make this safe.
//   c. STORAGE_SMOKE_MODE_ENABLED=true is set in the server's own process
//      env. Defaults OFF/unset, exactly like the existing BRIEF_STUB_MODE /
//      GAP_STUB_MODE / ADDENDUM_STUB_MODE flags (see
//      lib/services/ai/providerReadiness.ts's module doc — none of those
//      three go through getSetting()/AppSetting either; they are direct,
//      per-call process.env reads with no DB-backed override, and this flag
//      follows that exact, already-established convention rather than the
//      DB-backed getSetting() path used for user-facing credentials).
//   d. env.APP_ENV === "staging" — a server-side identity fact set exclusively
//      by whoever deploys/configures the container (runtime/env/staging.env.example),
//      Zod-validated at boot in lib/env.ts, and NEVER derived from any part of
//      an incoming request. This is what makes the bypass untriggerable in
//      production even if an attacker somehow obtained an admin session and
//      knew about the header/flag.
//
// The marker header value itself is never persisted (no DB row, no log line)
// — it is read once into a boolean and discarded.
const STORAGE_SMOKE_HEADER = "x-specbook-storage-smoke";

// ── Master document-automation gate (Q03.2b: Admin-controlled) ─────────────
//
// The two post-upload fire-and-forget calls (generateBidIntelligence,
// triggerBriefRefresh — real, Anthropic-calling jobs) are gated by the
// GLOBAL persisted Admin setting via documentAutomationStatus() in
// lib/services/settings/documentAutomation.ts (default OFF; enabled only
// from the authenticated Admin panel; DOCUMENT_AUTOMATION_HARD_DISABLED is
// an exact-literal emergency lock that always wins; the legacy
// DOCUMENT_AUTOMATION_ENABLED env var is read nowhere and can never enable
// automation). Precedence is unchanged: if the 4-condition storage-smoke
// gate above decided suppression, `suppressed_for_storage_smoke` wins and
// the Admin setting is never consulted for the automationStatus value.

// ── Sidecar integration ────────────────────────────────────────────────────

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

type SidecarSection = {
  // Standard parser fields
  section_number: string;
  title: string;
  raw_text: string;
  page_start: number;
  page_end: number;
  table_count: number;
  page_count: number;
  // Intelligent pipeline fields
  csi?: string;
  analysis?: Record<string, unknown>;
  ai_extractions?: Record<string, unknown>;
};

async function parsePdfViaSidecar(
  buffer: Buffer,
  fileName: string,
): Promise<{ sections: SidecarSection[]; aiCostUsd?: number } | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), fileName);

    const headers: Record<string, string> = {};
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    // Upload always uses fast parse — AI analysis is a separate step
    const res = await fetch(`${SIDECAR_URL}/parse/specs`, {
      method: "POST",
      body: form,
      headers,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      console.warn(`[specbook/upload] sidecar returned ${res.status}, falling back to pdfjs-dist`);
      return null;
    }

    const data = await res.json() as { sections: SidecarSection[] };

    return {
      sections: data.sections,
      aiCostUsd: undefined,
    };
  } catch (err) {
    console.warn("[specbook/upload] sidecar unavailable, falling back to pdfjs-dist:", err);
    return null;
  }
}

// ── In-process PDF fallback (used only when the sidecar is unavailable) ────
//
// pdfjs-dist's Node build references DOMMatrix/ImageData/Path2D at module
// scope (to support canvas rendering) and throws at import time if they're
// missing. We only ever call getTextContent(), which never touches them, so
// a no-op shim is enough to let the module load. The shim is installed here,
// inside the fallback path, rather than at route module scope — the route
// must import cleanly even in a runtime where these globals don't exist and
// the fallback is never reached.
async function parsePdfFallback(
  buffer: Buffer
): Promise<Array<{ csiNumber: string; csiTitle: string; rawText: string }>> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (globalThis as any).DOMMatrix ??= class DOMMatrix {};
    (globalThis as any).ImageData ??= class ImageData {};
    (globalThis as any).Path2D ??= class Path2D {};
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const pdfDoc = await loadingTask.promise;
    let rawText = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      rawText +=
        content.items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ") + "\n";
    }
    return parseSpecSections(rawText);
  } catch (err) {
    // Never surface the underlying error (module path, parser internals,
    // document content) to the client — log it server-side and fail with a
    // fixed, generic message the caller can safely display.
    console.error("[specbook/upload] pdfjs-dist fallback failed:", err);
    throw new Error("PDF fallback parser unavailable");
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  // ── Storage-only smoke gate — see module doc above for the full 4-condition
  // contract. Checked immediately after parent-Bid authorization and before
  // any route-local read/write below, because any request
  // carrying the marker header is an EXPLICIT storage-smoke attempt and must
  // NEVER be allowed to silently fall through into normal (real-provider-
  // calling) automation just because one of the other three conditions isn't
  // met — that silent fallthrough is exactly the gap this gate closes. A
  // reject here happens before the route's bid/trade queries, BlobStore.put,
  // and prisma.specBook.create, so none of the reject branches below can
  // ever leave a DB row or blob behind.
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
    // ALL FOUR conditions hold — proceed into the normal upload/parse
    // mechanics below, but suppress the post-parse provider-bound jobs.
    suppressAutomationForStorageSmoke = true;
  }

  // AI analysis is now a separate step — see /api/bids/[id]/specbook/analyze

  // Verify bid exists
  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Load all trades in dictionary + bid's assigned trade ids
  const [allTrades, bidTrades] = await Promise.all([
    prisma.trade.findMany({ select: { id: true, csiCode: true } }),
    prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
  ]);
  const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (file.type !== "application/pdf" && ext !== ".pdf") {
    return Response.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  // Every upload receives a collision-safe immutable key. A corrected or even
  // byte-identical re-upload appends a source revision; it never overwrites
  // the bytes cited by an earlier effective manifest.
  const buffer = Buffer.from(await file.arrayBuffer());
  const immutableId = randomUUID();
  const storageKey = specRevisionStorageKey(
    bidId,
    immutableId,
    safeBlobFileName(file.name),
  );
  const store = getBlobStore();
  let stored: PutResult;
  try {
    stored = await store.put(storageKey, buffer, { contentType: "application/pdf" });
  } catch (err) {
    console.error("[specbook/upload] blob write failed:", err);
    return Response.json({ error: "Storage write failed — file not saved" }, { status: 500 });
  }

  let specBook;
  try {
    let committed = null;
    for (let attempt = 0; attempt < 3 && !committed; attempt += 1) {
      try {
        committed = await prisma.$transaction(async (tx) => {
          const [active, latest] = await Promise.all([
            tx.specBook.findFirst({
              where: { bidId, activeSlot: 1 },
              select: { id: true, revisionIndex: true },
            }),
            tx.specBook.findFirst({
              where: { bidId },
              orderBy: [{ revisionIndex: "desc" }, { uploadedAt: "desc" }, { id: "desc" }],
              select: { id: true, revisionIndex: true },
            }),
          ]);
          const prior = active ?? latest;
          const revisionIndex = (latest?.revisionIndex ?? 0) + 1;
          if (prior) {
            await tx.specBook.update({
              where: { id: prior.id },
              data: {
                revisionIndex: prior.revisionIndex ?? 0,
                effectiveState: "SUPERSEDED",
                activeSlot: null,
              },
            });
          }
          return tx.specBook.create({
            data: {
              bidId,
              fileName: file.name,
              filePath: storageKey,
              status: "processing",
              revisionIndex,
              effectiveState: "EFFECTIVE",
              effectiveAt: new Date(),
              effectiveBy: access.user.id,
              supersedesSpecBookId: prior?.id ?? null,
              sha256: stored.sha256,
              byteSize: stored.size,
              mimeType: stored.contentType ?? "application/pdf",
              immutableId,
              activeSlot: 1,
            },
          });
        });
      } catch (error) {
        const conflict =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "P2002";
        if (!conflict || attempt === 2) throw error;
      }
    }
    if (!committed) throw new Error("Spec revision allocation failed");
    specBook = committed;
  } catch (err) {
    await deleteSpecStorageIfUnreferenced(storageKey, bidId).catch(() => undefined);
    console.error("[specbook/upload] database revision append failed:", err);
    return Response.json(
      { error: "Spec revision could not be recorded — upload rolled back" },
      { status: 500 },
    );
  }

  // Extract text and parse sections
  try {
    // Try sidecar first (PyMuPDF4LLM — handles large files, better table extraction)
    const sidecarResult = await parsePdfViaSidecar(buffer, file.name);

    let sections: Array<{
      csiNumber: string;
      csiTitle: string;
      rawText: string;
      aiExtractions?: string;
      pageStart?: number | null;
      pageEnd?: number | null;
      pageCount?: number | null;
    }>;

    if (sidecarResult && sidecarResult.sections.length > 0) {
      console.log(`[specbook/upload] sidecar parsed ${sidecarResult.sections.length} sections`);
      sections = sidecarResult.sections.map((s) => ({
        csiNumber: s.section_number || s.csi || "",
        csiTitle: s.title,
        rawText: s.raw_text,
        pageStart: s.page_start,
        pageEnd: s.page_end,
        pageCount: s.page_count,
      }));
    } else {
      // Fallback: pdfjs-dist (in-process, may struggle with large files)
      console.log("[specbook/upload] using pdfjs-dist fallback");
      sections = await parsePdfFallback(buffer);
    }

    // Store both the compatibility SpecSection projection and its immutable
    // evidence revision/paragraphs in one transaction.
    if (sections.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const s of sections) {
          const { tradeId, matchedTradeId } = matchSectionThreeState(
            s.csiNumber,
            allTrades,
            bidTradeIds
          );
          const section = await tx.specSection.create({
            data: {
              specBookId: specBook.id,
              csiNumber: s.csiNumber,
              csiTitle: s.csiTitle,
              rawText: s.rawText,
              source: "specbook",
              tradeId,
              matchedTradeId,
              covered: tradeId !== null,
              aiExtractions: s.aiExtractions ?? null,
              pageStart: s.pageStart ?? null,
              pageEnd: s.pageEnd ?? null,
              pageCount: s.pageCount ?? null,
            },
          });
          await appendSectionEvidenceTx(tx as unknown as Prisma.TransactionClient, {
            bidId,
            specSectionId: section.id,
            rawText: s.rawText,
            pageStart: s.pageStart ?? null,
            pageEnd: s.pageEnd ?? null,
            pageCount: s.pageCount ?? null,
          });
        }
      });
    }

    const updated = await prisma.specBook.update({
      where: { id: specBook.id },
      data: { status: "ready" },
      include: { _count: { select: { sections: true } } },
    });

    const coveredCount = await prisma.specSection.count({
      where: { specBookId: specBook.id, covered: true },
    });

    // The 4-condition storage-smoke gate at the top of this handler already
    // decided suppression (or rejected the request outright, before any
    // persistence, if the marker was present but any condition failed) — by
    // the time execution reaches here, either no marker was sent, or all four
    // conditions held. Nothing to re-check. Storage-smoke suppression takes
    // precedence over the Admin setting (see the gate doc above) — the
    // setting is only consulted when storage-smoke suppression does not apply.
    const automationStatus: "triggered" | "suppressed_for_storage_smoke" | "disabled" | "hard_disabled" =
      suppressAutomationForStorageSmoke
        ? "suppressed_for_storage_smoke"
        : await documentAutomationStatus();

    if (automationStatus === "triggered") {
      // Fire-and-forget intelligence regeneration — does not block upload response
      generateBidIntelligence(bidId).catch((err) =>
        console.error("[specbook/upload] background intelligence generation failed:", err)
      );
      triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
        console.error("[specbook/upload] background brief refresh failed:", err)
      );
    }

    return Response.json(
      {
        ...updated,
        coveredCount,
        gapCount: updated._count.sections - coveredCount,
        automationStatus,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/specbook/upload] parse error:", err);

    // Retain the failed immutable attempt, but do not leave it occupying the
    // active source slot. Restore the prior source only when this revision is
    // still active; a newer concurrent upload always wins.
    try {
      await prisma.$transaction(async (tx) => {
        const released = await tx.specBook.updateMany({
          where: { id: specBook.id, activeSlot: 1 },
          data: {
            status: "error",
            effectiveState: "VOID",
            activeSlot: null,
          },
        });
        if (released.count === 0) {
          await tx.specBook.update({
            where: { id: specBook.id },
            data: { status: "error" },
          });
          return;
        }
        if (specBook.supersedesSpecBookId !== null) {
          await tx.specBook.update({
            where: { id: specBook.supersedesSpecBookId },
            data: {
              effectiveState: "EFFECTIVE",
              activeSlot: 1,
            },
          });
        }
      });
    } catch {
      // A newer revision can win this race. Evidence retention is still safe;
      // leave recovery to the next explicit revision/backfill operation.
    }

    return Response.json({ error: message }, { status: 422 });
  }
}
