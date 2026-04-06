import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

type ScopeLine = {
  division: string;
  description: string;
  quantity?: string;
  unit?: string;
};

function scopeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// GET /api/bids/[id]/leveling
// Find-or-create LevelingSession, upsert rows from all complete uploads,
// return rows grouped by trade. Never touches pricingData.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      selections: {
        select: { subcontractorId: true, tradeId: true },
      },
    },
  });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });

  // Build subcontractorId -> tradeId map (first selection wins)
  const subTradeMap = new Map<number, number | null>();
  for (const sel of bid.selections) {
    if (!subTradeMap.has(sel.subcontractorId)) {
      subTradeMap.set(sel.subcontractorId, sel.tradeId);
    }
  }

  // Find-or-create leveling session
  const session = await prisma.levelingSession.upsert({
    where: { bidId },
    create: { bidId },
    update: {},
  });

  // Load complete uploads — select scopeLines only, pricingData excluded at query layer
  const uploads = await prisma.estimateUpload.findMany({
    where: { bidId, parseStatus: "complete" },
    select: {
      id: true,
      subcontractorId: true,
      fileName: true,
      scopeLines: true,
    },
    orderBy: { uploadedAt: "asc" },
  });

  // Upsert LevelingRows for each upload
  for (const upload of uploads) {
    let lines: ScopeLine[] = [];
    try {
      const parsed = JSON.parse(upload.scopeLines);
      if (Array.isArray(parsed)) lines = parsed;
    } catch {
      lines = [];
    }

    const tradeId = subTradeMap.get(upload.subcontractorId) ?? null;

    for (const line of lines) {
      const text = line.description?.trim();
      if (!text) continue;
      const hash = scopeHash(text);

      await prisma.levelingRow.upsert({
        where: {
          estimateUploadId_scopeHash: {
            estimateUploadId: upload.id,
            scopeHash: hash,
          },
        },
        create: {
          sessionId: session.id,
          estimateUploadId: upload.id,
          tradeId,
          division: line.division ?? "",
          scopeText: text,
          scopeHash: hash,
        },
        update: {
          // Preserve status and note — only update structural fields
          division: line.division ?? "",
          scopeText: text,
          tradeId,
        },
      });
    }
  }

  // Load all rows for this session
  const rows = await prisma.levelingRow.findMany({
    where: { sessionId: session.id },
    include: {
      trade: { select: { id: true, name: true } },
    },
    orderBy: [{ tradeId: "asc" }, { id: "asc" }],
  });

  // Build ordered subs list for column headers
  const subList: {
    estimateUploadId: number;
    subcontractorId: number;
    fileName: string;
    label: string;
  }[] = [];
  const seenUploads = new Set<number>();
  let subIndex = 1;
  for (const upload of uploads) {
    if (!seenUploads.has(upload.id)) {
      seenUploads.add(upload.id);
      subList.push({
        estimateUploadId: upload.id,
        subcontractorId: upload.subcontractorId,
        fileName: upload.fileName,
        label: `Sub ${subIndex++}`,
      });
    }
  }

  // Group rows by trade
  const tradeOrder: string[] = [];
  const tradeMap = new Map<
    string,
    {
      tradeId: number | null;
      tradeName: string;
      rows: {
        id: number;
        estimateUploadId: number;
        division: string;
        scopeText: string;
        status: string;
        note: string | null;
      }[];
    }
  >();

  for (const row of rows) {
    const key = row.tradeId != null ? String(row.tradeId) : "unassigned";
    if (!tradeMap.has(key)) {
      tradeOrder.push(key);
      tradeMap.set(key, {
        tradeId: row.tradeId,
        tradeName: row.trade?.name ?? "Unassigned",
        rows: [],
      });
    }
    tradeMap.get(key)!.rows.push({
      id: row.id,
      estimateUploadId: row.estimateUploadId,
      division: row.division,
      scopeText: row.scopeText,
      status: row.status,
      note: row.note,
    });
  }

  return Response.json({
    sessionId: session.id,
    status: session.status,
    subs: subList,
    trades: tradeOrder.map((k) => tradeMap.get(k)!),
  });
}
