import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore, localPathForKey } from "@/lib/storage/blobStore";
import { lookupCanonicalTitles } from "@/lib/services/csi/canonicalTitle";
import {
  resolveLocalPath,
  specSectionStoragePrefix,
} from "@/lib/services/specbook/storagePath";
import { appendSectionEvidenceTx } from "@/lib/services/specEvidence/evidence";

// POST /api/bids/[id]/specbook/split
//
// Takes the already-uploaded spec book and splits it into per-section PDFs
// using the sidecar. Each section gets its own PDF file + SpecSection record
// is updated with pdfPath, pageStart, pageEnd, pageCount.
//
// This is a separate step after upload — replaces the regex-parsed sections
// with accurate page-range-based sections (Procore-style).

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready", activeSlot: 1 },
    orderBy: [{ revisionIndex: "desc" }, { uploadedAt: "desc" }],
  });

  // Rows created before source versioning have no active-slot marker. They
  // remain splittable until the explicit bid-scoped backfill assigns revision
  // zero and publishes the first effective set.
  specBook ??= await prisma.specBook.findFirst({
    where: {
      bidId,
      status: "ready",
      revisionIndex: null,
      activeSlot: null,
    },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
  });

  if (!specBook) {
    return Response.json({ error: "No spec book uploaded" }, { status: 404 });
  }

  // Resolve an absolute filesystem path for the sidecar handoff. New records
  // store a relative BlobStore key; pre-migration records may hold a legacy
  // cwd-rooted absolute path, or a production storage-root absolute path —
  // see lib/services/specbook/storagePath.ts for the full shape breakdown.
  const resolved = await resolveLocalPath(specBook.filePath, bidId);
  if (!resolved.ok) {
    return Response.json({ error: "Spec book file not found on disk" }, { status: 404 });
  }
  const sourcePdfPath = resolved.localPath;

  // The sidecar writes split section PDFs directly onto the shared /storage
  // mount — both containers mount the same durable root at the same
  // absolute path, so what the sidecar writes here is already at its final
  // BlobStore-relative location; no extra copy through BlobStore.put needed.
  const sectionsKeyPrefix = specSectionStoragePrefix(
    bidId,
    specBook.immutableId ?? `specbook-${specBook.id}`,
    randomUUID(),
  );
  const outputDir = localPathForKey(sectionsKeyPrefix);

  // Call sidecar split endpoint
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const res = await fetch(`${SIDECAR_URL}/parse/specs/split`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pdf_path: sourcePdfPath,
        output_dir: outputDir,
      }),
      signal: AbortSignal.timeout(300_000), // 5 min for split
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar returned ${res.status}` }));
      return Response.json({ error: err.detail ?? "Split failed" }, { status: res.status });
    }

    const data = (await res.json()) as {
      sections: Array<{
        csi: string;
        title: string;
        pdf_path: string;
        filename: string;
        page_start: number;
        page_end: number;
        page_count: number;
        text: string;
      }>;
      section_count: number;
    };

    console.log(`[specbook/split] split into ${data.section_count} sections`);

    // Load trades for three-state matching
    const [allTrades, bidTrades] = await Promise.all([
      prisma.trade.findMany({ select: { id: true, csiCode: true } }),
      prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
    ]);
    const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

    function matchTrade(csi: string): { tradeId: number | null; matchedTradeId: number | null } {
      const digits = csi.replace(/\D/g, "");
      if (!digits) return { tradeId: null, matchedTradeId: null };
      for (const t of allTrades) {
        if (!t.csiCode) continue;
        if (t.csiCode.replace(/\D/g, "") === digits) {
          return bidTradeIds.has(t.id)
            ? { tradeId: t.id, matchedTradeId: null }
            : { tradeId: null, matchedTradeId: t.id };
        }
      }
      return { tradeId: null, matchedTradeId: null };
    }

    // Enrich with canonical MasterFormat titles (safe lookup — only accepts
    // matches where the doc title overlaps with the canonical title)
    const canonicalMap = await lookupCanonicalTitles(
      data.sections.map((s) => ({ csiNumber: s.csi, docTitle: s.title }))
    );

    const existingSections = await prisma.specSection.findMany({
      where: { specBookId: specBook.id },
      orderBy: { id: "asc" },
    });
    const availableByCsi = new Map<string, typeof existingSections>();
    for (const section of existingSections) {
      const rows = availableByCsi.get(section.csiNumber) ?? [];
      rows.push(section);
      availableByCsi.set(section.csiNumber, rows);
    }

    // SpecSection remains the compatibility projection. Every split appends
    // immutable section evidence and paragraph rows; prior source bytes and
    // evidence are never deleted or overwritten.
    let createdCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const s of data.sections) {
        const match = matchTrade(s.csi);
        const pdfPath = `${sectionsKeyPrefix}/${s.filename}`;
        const text = s.text.slice(0, 10000);
        const prior = availableByCsi.get(s.csi)?.shift();
        const section = prior
          ? await tx.specSection.update({
              where: { id: prior.id },
              data: {
                csiTitle: s.title,
                csiCanonicalTitle: canonicalMap.get(s.csi.trim()) ?? null,
                rawText: text,
                source: "split_pdf",
                tradeId: match.tradeId,
                matchedTradeId: match.matchedTradeId,
                covered: match.tradeId !== null,
                pdfPath,
                pdfFileName: s.filename,
                pageStart: s.page_start,
                pageEnd: s.page_end,
                pageCount: s.page_count,
              },
            })
          : await tx.specSection.create({
              data: {
                specBookId: specBook.id,
                csiNumber: s.csi,
                csiTitle: s.title,
                csiCanonicalTitle: canonicalMap.get(s.csi.trim()) ?? null,
                rawText: text,
                source: "split_pdf",
                tradeId: match.tradeId,
                matchedTradeId: match.matchedTradeId,
                covered: match.tradeId !== null,
                pdfPath,
                pdfFileName: s.filename,
                pageStart: s.page_start,
                pageEnd: s.page_end,
                pageCount: s.page_count,
              },
            });
        if (!prior) createdCount += 1;
        const stat = await getBlobStore().stat(pdfPath);
        await appendSectionEvidenceTx(tx as unknown as Prisma.TransactionClient, {
          bidId,
          specSectionId: section.id,
          rawText: text,
          pdfPath,
          pdfSha256: stat?.sha256 ?? null,
          pdfByteSize: stat?.size ?? null,
          pageStart: s.page_start,
          pageEnd: s.page_end,
          pageCount: s.page_count,
        });
      }
    });

    return Response.json({
      success: true,
      sectionsCreated: createdCount,
      sectionCount: data.section_count,
      canonicalMatches: canonicalMap.size,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw === "fetch failed"
      ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
      : raw;
    console.error("[specbook/split] error:", err);
    return Response.json({ error: message }, { status: 422 });
  }
}
