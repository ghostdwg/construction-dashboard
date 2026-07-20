import path from "path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  parseDrawingSheets,
  firstSheetByDiscipline,
  DISCIPLINE_TRADE_NAMES,
} from "@/lib/documents/drawingParser";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";
import { triggerBriefRefresh } from "@/lib/services/jobs/briefRefreshAutomation";
import { documentAutomationStatus } from "@/lib/services/settings/documentAutomation";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { drawingStorageKey } from "@/lib/services/drawings/storagePath";
import { deleteDrawingStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";
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

// ── Master document-automation gate (Q03.2b: Admin-controlled) — IDENTICAL
// semantics to app/api/bids/[id]/specbook/upload/route.ts (see that module's
// doc): gated by the GLOBAL persisted Admin setting via
// documentAutomationStatus() (default OFF; DOCUMENT_AUTOMATION_HARD_DISABLED
// emergency lock always wins; legacy env var read nowhere). Independent of,
// and subordinate to, the 4-condition storage-smoke gate above:
// `suppressed_for_storage_smoke` always wins.

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

type PreparedSheet = {
  sheetNumber: string;
  sheetTitle: string | null;
  discipline: string;
  tradeId: number | null;
  matchedTradeId: number | null;
};

async function prepareDrawing(
  buffer: Buffer,
  fileName: string,
  discipline: Discipline,
  bidId: number,
) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdfDoc = await loadingTask.promise;
  let rawText = "";
  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
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
  const relevantPrefixes = DISCIPLINE_TO_PREFIX[discipline] ?? [];
  const discovered =
    discipline === "FULLSET"
      ? Array.from(firstSheet.keys())
      : Array.from(firstSheet.keys()).filter((value) => relevantPrefixes.includes(value));
  const rowDisciplines =
    discovered.length === 0 && discipline !== "FULLSET"
      ? relevantPrefixes
      : discovered;

  const [allTrades, bidTrades] = await Promise.all([
    prisma.trade.findMany({ select: { id: true, name: true } }),
    prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
  ]);
  const bidTradeIds = new Set(bidTrades.map((bidTrade) => bidTrade.tradeId));
  const tradeByName = new Map(allTrades.map((trade) => [trade.name, trade.id]));
  const rows: PreparedSheet[] = [];

  for (const prefix of rowDisciplines) {
    for (const tradeName of DISCIPLINE_TRADE_NAMES[prefix] ?? []) {
      const tradeId = tradeByName.get(tradeName) ?? null;
      if (tradeId === null) continue;
      rows.push({
        sheetNumber: firstSheet.get(prefix) ?? `${prefix}-*`,
        sheetTitle: firstSheet.has(prefix) ? null : fileName.replace(/\.pdf$/i, ""),
        discipline: prefix,
        tradeId: bidTradeIds.has(tradeId) ? tradeId : null,
        matchedTradeId: bidTradeIds.has(tradeId) ? null : tradeId,
      });
    }
  }

  return {
    rows,
    disciplineCount: rowDisciplines.length,
    sheetCount: sheets.length,
    coveredCount: rows.filter((row) => row.tradeId !== null).length,
    missingCount: rows.filter((row) => row.matchedTradeId !== null).length,
  };
}

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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

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

  const buffer = Buffer.from(await file.arrayBuffer());
  let prepared: Awaited<ReturnType<typeof prepareDrawing>>;
  try {
    prepared = await prepareDrawing(buffer, file.name, discipline, bidId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/drawings/upload] parse error:", err);
    return Response.json({ error: message }, { status: 422 });
  }

  const store = getBlobStore();
  const storedKey = drawingStorageKey(bidId, randomUUID(), safeBlobFileName(file.name));
  try {
    await store.put(storedKey, buffer, { contentType: "application/pdf" });
  } catch (err) {
    console.error("[drawings/upload] blob write failed:", err);
    return Response.json({ error: "Storage write failed — file not saved" }, { status: 500 });
  }

  const replacementWhere =
    discipline === "FULLSET"
      ? { bidId }
      : { bidId, discipline: { in: [discipline, "FULLSET"] } };
  let committed: { id: number; superseded: Array<{ filePath: string }> };
  try {
    committed = await prisma.$transaction(async (tx) => {
      const superseded = await tx.drawingUpload.findMany({
        where: replacementWhere,
        select: { filePath: true },
      });
      const created = await tx.drawingUpload.create({
        data: {
          bidId,
          fileName: file.name,
          filePath: storedKey,
          status: "ready",
          discipline,
        },
      });
      if (prepared.rows.length > 0) {
        await tx.drawingSheet.createMany({
          data: prepared.rows.map((row) => ({ ...row, drawingUploadId: created.id })),
        });
      }
      await tx.drawingUpload.deleteMany({
        where: { ...replacementWhere, id: { not: created.id } },
      });
      return { id: created.id, superseded };
    });
  } catch (err) {
    await deleteDrawingStorageIfUnreferenced(storedKey, bidId).catch(() => undefined);
    console.error("[drawings/upload] database replacement failed:", err);
    return Response.json(
      { error: "Drawing could not be recorded — upload rolled back" },
      { status: 500 },
    );
  }

  await Promise.all(
    Array.from(new Set(committed.superseded.map((row) => row.filePath))).map((oldRef) =>
      deleteDrawingStorageIfUnreferenced(oldRef, bidId).catch((err) =>
        console.error("[drawings/upload] superseded blob cleanup failed:", err),
      ),
    ),
  );

  const automationStatus:
    | "triggered"
    | "suppressed_for_storage_smoke"
    | "disabled"
    | "hard_disabled" = suppressAutomationForStorageSmoke
    ? "suppressed_for_storage_smoke"
    : await documentAutomationStatus();
  if (automationStatus === "triggered") {
    generateBidIntelligence(bidId).catch((err) =>
      console.error("[drawings/upload] background intelligence generation failed:", err),
    );
    triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
      console.error("[drawings/upload] background brief refresh failed:", err),
    );
  }

  return Response.json(
    {
      id: committed.id,
      discipline,
      disciplineCount: prepared.disciplineCount,
      sheetCount: prepared.sheetCount,
      coveredCount: prepared.coveredCount,
      missingCount: prepared.missingCount,
      automationStatus,
    },
    { status: 201 },
  );
}
