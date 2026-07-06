import path from "path";
import { prisma } from "@/lib/prisma";
import {
  parseDrawingSheets,
  firstSheetByDiscipline,
  DISCIPLINE_TRADE_NAMES,
} from "@/lib/documents/drawingParser";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";
import { triggerBriefRefresh } from "@/lib/services/jobs/briefRefreshAutomation";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { drawingStorageKey } from "@/lib/services/drawings/storagePath";
import { env } from "@/lib/env";
// isAdminAuthorized (lib/auth.ts) is imported dynamically below, only inside
// the storage-smoke gate branch — this route is on the hot path for every
// drawing upload, and lib/auth.ts pulls in the full next-auth module graph.
// The overwhelming majority of requests never send the smoke marker header,
// so deferring the import keeps their cost identical to before this feature
// existed (no next-auth module load at all on that path).

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// ── Storage-only smoke mode (work package: storage-smoke-isolation) ────────
//
// Lets an operator validate upload/serve/delete storage mechanics on staging
// WITHOUT triggering a real Anthropic call, while a credential rotation is
// pending. This is NOT a generic "skip AI" switch — suppression only ever
// engages when ALL FOUR of the following hold simultaneously. Semantics are
// IDENTICAL to the Spec Book gate at
// app/api/bids/[id]/specbook/upload/route.ts (see that module's doc for the
// full rationale) — only the marker header name differs (domain-scoped).
//
// Fail-closed contract: if the marker header (b) is ABSENT, this route
// behaves exactly as it did before this feature existed — normal automation
// fires unconditionally, no extra check is even performed. But if the marker
// header IS present, this is treated as an EXPLICIT storage-smoke attempt —
// and if any of the other three conditions (a/c/d) is not also true, the
// request is REJECTED outright (a controlled, non-2xx response, before any
// BlobStore write or DB persistence) rather than silently falling through to
// normal automation.
//
//   a. Authenticated ADMIN session (reuses lib/auth.ts's isAdminAuthorized()).
//   b. The caller sent the non-secret intent marker header below.
//   c. STORAGE_SMOKE_MODE_ENABLED=true is set in the server's own process
//      env. Defaults OFF/unset.
//   d. env.APP_ENV === "staging" — a server-side identity fact, never
//      derived from any part of an incoming request.
//
// The marker header value itself is never persisted (no DB row, no log line)
// — it is read once into a boolean and discarded.
const STORAGE_SMOKE_HEADER = "x-drawings-storage-smoke";

// ── Master document-automation gate (release-hardening: routine document
// operations must not fire real, provider-bound automation with no master
// gate) — IDENTICAL semantics to the gate in
// app/api/bids/[id]/specbook/upload/route.ts (see that module's doc for the
// full rationale). Defaults OFF/unset; only the literal string "true"
// enables it; a direct process.env read, no lib/env.ts Zod entry, following
// the same established convention as STORAGE_SMOKE_MODE_ENABLED and the
// *_STUB_MODE flags. Independent of, and subordinate to, the 4-condition
// storage-smoke gate above: `suppressed_for_storage_smoke` always wins.
function isDocumentAutomationEnabled(): boolean {
  return process.env.DOCUMENT_AUTOMATION_ENABLED === "true";
}

// Valid discipline values for per-discipline uploads
const VALID_DISCIPLINES = [
  "FULLSET",
  "GENERAL",
  "CIVIL",
  "ARCH",
  "STRUCT",
  "MECH",
  "ELEC",
  "PLUMB",
  "INTERIOR",
  "FP",
] as const;

type Discipline = (typeof VALID_DISCIPLINES)[number];

// Map discipline upload tags to the drawing parser's prefix letters
const DISCIPLINE_TO_PREFIX: Record<string, string[]> = {
  GENERAL: ["A"], // General sheets often use A-prefix with low numbers
  CIVIL: ["C"],
  ARCH: ["A"],
  STRUCT: ["S"],
  MECH: ["M"],
  ELEC: ["E"],
  PLUMB: ["P"],
  INTERIOR: ["A"], // Interior often falls under A-prefix
  FP: ["FP"],
  FULLSET: ["A", "S", "M", "P", "E", "C", "FP"],
};

// POST /api/bids/[id]/drawings/upload
// Accepts a drawing PDF with optional discipline tag.
// ?discipline=ARCH uploads as architectural sheets.
// ?discipline=FULLSET (default) uploads as a combined set.
// Re-uploading a discipline replaces only that discipline's upload.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  // ── Storage-only smoke gate — see module doc above for the full 4-condition
  // contract. Checked FIRST, before any read/write below, because any request
  // carrying the marker header is an EXPLICIT storage-smoke attempt and must
  // NEVER be allowed to silently fall through into normal (real-provider-
  // calling) automation just because one of the other three conditions isn't
  // met.
  //
  // Cheapest, non-auth checks first, so the default (no marker header)
  // request path — the overwhelming majority of traffic — pays for nothing
  // beyond a single header read and short-circuits immediately.
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

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Parse discipline from query string
  const url = new URL(request.url);
  const rawDiscipline = (url.searchParams.get("discipline") ?? "FULLSET").toUpperCase();
  if (!VALID_DISCIPLINES.includes(rawDiscipline as Discipline)) {
    return Response.json(
      { error: `Invalid discipline. Must be one of: ${VALID_DISCIPLINES.join(", ")}` },
      { status: 400 }
    );
  }
  const discipline = rawDiscipline as Discipline;

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

  // Persist durably through BlobStore under a relative key matching
  // production's namespace convention (uploads/drawings/{bidId}/{safe name})
  // — never an absolute path. Only a relative BlobStore key is ever stored
  // in DrawingUpload.filePath going forward; resolving it back to a real
  // local absolute path (for the sidecar analyze handoff) happens later, at
  // that trusted boundary, via lib/services/drawings/storagePath.ts.
  const buffer = Buffer.from(await file.arrayBuffer());
  const storedKey = drawingStorageKey(bidId, safeBlobFileName(file.name));
  await getBlobStore().put(storedKey, buffer);
  const filePath = storedKey;

  // Delete existing upload for this discipline only (sheets cascade)
  // If uploading FULLSET, also delete all per-discipline uploads (replacing everything)
  // If uploading a discipline, also delete any FULLSET upload (switching modes)
  if (discipline === "FULLSET") {
    await prisma.drawingUpload.deleteMany({ where: { bidId } });
  } else {
    await prisma.drawingUpload.deleteMany({
      where: { bidId, discipline: { in: [discipline, "FULLSET"] } },
    });
  }

  const drawingUpload = await prisma.drawingUpload.create({
    data: { bidId, fileName: file.name, filePath, status: "processing", discipline },
  });

  try {
    // Extract text with pdfjs-dist
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

    const sheets = parseDrawingSheets(rawText);
    const firstSheet = firstSheetByDiscipline(sheets);

    // For per-discipline uploads, use the known discipline prefix mapping
    // For fullset, use all discovered disciplines
    const relevantPrefixes = DISCIPLINE_TO_PREFIX[discipline] ?? [];
    const disciplines =
      discipline === "FULLSET"
        ? Array.from(firstSheet.keys())
        : Array.from(firstSheet.keys()).filter((d) => relevantPrefixes.includes(d));

    // If no disciplines found via parsing, create a single entry for the uploaded discipline
    // This handles PDFs where text extraction can't find sheet numbers
    if (disciplines.length === 0 && discipline !== "FULLSET") {
      const allTrades = await prisma.trade.findMany({ select: { id: true, name: true } });
      const bidTrades = await prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } });
      const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));
      const tradeByName = new Map(allTrades.map((t) => [t.name, t.id]));

      // Map discipline to trades using the parser's mapping
      const prefixes = DISCIPLINE_TO_PREFIX[discipline] ?? [];
      const rows: Array<{
        drawingUploadId: number;
        sheetNumber: string;
        sheetTitle: string | null;
        discipline: string;
        tradeId: number | null;
        matchedTradeId: number | null;
      }> = [];

      for (const prefix of prefixes) {
        const tradeNames = DISCIPLINE_TRADE_NAMES[prefix] ?? [];
        for (const name of tradeNames) {
          const tradeId = tradeByName.get(name) ?? null;
          if (tradeId === null) continue;
          rows.push({
            drawingUploadId: drawingUpload.id,
            sheetNumber: `${prefix}-*`,
            sheetTitle: file.name.replace(/\.pdf$/i, ""),
            discipline: prefix,
            tradeId: bidTradeIds.has(tradeId) ? tradeId : null,
            matchedTradeId: bidTradeIds.has(tradeId) ? null : tradeId,
          });
        }
      }

      if (rows.length > 0) {
        await prisma.drawingSheet.createMany({ data: rows });
      }

      await prisma.drawingUpload.update({
        where: { id: drawingUpload.id },
        data: { status: "ready" },
      });

      const coveredCount = rows.filter((r) => r.tradeId !== null).length;
      const missingCount = rows.filter((r) => r.matchedTradeId !== null).length;

      // The 4-condition storage-smoke gate at the top of this handler already
      // decided suppression (or rejected the request outright, before any
      // persistence, if the marker was present but any condition failed) — by
      // the time execution reaches here, either no marker was sent, or all
      // four conditions held. Nothing to re-check. Storage-smoke suppression
      // takes precedence over the master automation flag — see
      // isDocumentAutomationEnabled's doc above.
      const automationStatus: "triggered" | "suppressed_for_storage_smoke" | "disabled" =
        suppressAutomationForStorageSmoke
          ? "suppressed_for_storage_smoke"
          : isDocumentAutomationEnabled()
            ? "triggered"
            : "disabled";

      if (automationStatus === "triggered") {
        generateBidIntelligence(bidId).catch((err) =>
          console.error("[drawings/upload] background intelligence generation failed:", err)
        );
        triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
          console.error("[drawings/upload] background brief refresh failed:", err)
        );
      }

      return Response.json(
        {
          id: drawingUpload.id,
          discipline,
          disciplineCount: prefixes.length,
          sheetCount: 0,
          coveredCount,
          missingCount,
          automationStatus,
        },
        { status: 201 }
      );
    }

    // Standard path: parse found sheets
    const [allTrades, bidTrades] = await Promise.all([
      prisma.trade.findMany({ select: { id: true, name: true } }),
      prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
    ]);
    const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));
    const tradeByName = new Map(allTrades.map((t) => [t.name, t.id]));

    type SheetData = {
      drawingUploadId: number;
      sheetNumber: string;
      sheetTitle: string | null;
      discipline: string;
      tradeId: number | null;
      matchedTradeId: number | null;
    };

    const rows: SheetData[] = [];
    for (const disc of disciplines) {
      const tradeNames = DISCIPLINE_TRADE_NAMES[disc] ?? [];
      const repSheet = firstSheet.get(disc)!;

      for (const name of tradeNames) {
        const tradeId = tradeByName.get(name) ?? null;
        if (tradeId === null) continue;

        rows.push({
          drawingUploadId: drawingUpload.id,
          sheetNumber: repSheet,
          sheetTitle: null,
          discipline: disc,
          tradeId: bidTradeIds.has(tradeId) ? tradeId : null,
          matchedTradeId: bidTradeIds.has(tradeId) ? null : tradeId,
        });
      }
    }

    if (rows.length > 0) {
      await prisma.drawingSheet.createMany({ data: rows });
    }

    const updated = await prisma.drawingUpload.update({
      where: { id: drawingUpload.id },
      data: { status: "ready" },
    });

    const coveredCount = rows.filter((r) => r.tradeId !== null).length;
    const missingCount = rows.filter((r) => r.matchedTradeId !== null).length;

    // Same suppression contract as the early-return branch above — see the
    // module doc and the gate at the top of this handler.
    const automationStatus: "triggered" | "suppressed_for_storage_smoke" | "disabled" =
      suppressAutomationForStorageSmoke
        ? "suppressed_for_storage_smoke"
        : isDocumentAutomationEnabled()
          ? "triggered"
          : "disabled";

    if (automationStatus === "triggered") {
      generateBidIntelligence(bidId).catch((err) =>
        console.error("[drawings/upload] background intelligence generation failed:", err)
      );
      triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
        console.error("[drawings/upload] background brief refresh failed:", err)
      );
    }

    return Response.json(
      {
        id: updated.id,
        discipline,
        disciplineCount: disciplines.length,
        sheetCount: sheets.length,
        coveredCount,
        missingCount,
        automationStatus,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/drawings/upload] parse error:", err);
    await prisma.drawingUpload.update({
      where: { id: drawingUpload.id },
      data: { status: "error" },
    });
    return Response.json({ error: message }, { status: 422 });
  }
}
