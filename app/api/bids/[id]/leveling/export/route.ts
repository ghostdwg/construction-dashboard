import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

// GET /api/bids/[id]/leveling/export
// Exports the full leveling matrix to .xlsx.
// One sheet per trade. Columns: Scope Item | Division | Sub 1 | Sub 2 | ... | Status | Notes
// Sub columns use anonymous tokens only — never real names or company info.
// clarification_needed rows: yellow fill. excluded rows: light red fill.
// pricingData is never loaded or referenced.

const STATUS_LABELS: Record<string, string> = {
  unreviewed: "Unreviewed",
  included: "Included",
  excluded: "Excluded",
  clarification_needed: "Clarify",
};

const YELLOW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF9C4" },
};

const RED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFCDD2" },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8E8E8" },
};

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
    select: {
      id: true,
      projectName: true,
      levelingSession: { select: { id: true } },
    },
  });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });
  if (!bid.levelingSession) {
    return Response.json(
      { error: "No leveling session found. Open the Leveling tab first." },
      { status: 404 }
    );
  }

  // Load complete uploads ordered by uploadedAt — defines Sub 1, Sub 2, ... labels
  const uploads = await prisma.estimateUpload.findMany({
    where: { bidId, parseStatus: "complete" },
    select: { id: true },
    orderBy: { uploadedAt: "asc" },
  });

  const subList: { estimateUploadId: number; label: string }[] = [];
  const seen = new Set<number>();
  let idx = 1;
  for (const u of uploads) {
    if (!seen.has(u.id)) {
      seen.add(u.id);
      subList.push({ estimateUploadId: u.id, label: `Sub ${idx++}` });
    }
  }

  // Load all leveling rows — no pricingData involved at any point
  const rows = await prisma.levelingRow.findMany({
    where: { sessionId: bid.levelingSession.id },
    include: { trade: { select: { id: true, name: true } } },
    orderBy: [{ tradeId: "asc" }, { id: "asc" }],
  });

  // Group by trade
  type TradeGroup = {
    tradeName: string;
    rows: typeof rows;
  };
  const tradeOrder: string[] = [];
  const tradeMap = new Map<string, TradeGroup>();

  for (const row of rows) {
    const key = row.tradeId != null ? String(row.tradeId) : "unassigned";
    if (!tradeMap.has(key)) {
      tradeOrder.push(key);
      tradeMap.set(key, { tradeName: row.trade?.name ?? "Unassigned", rows: [] });
    }
    tradeMap.get(key)!.rows.push(row);
  }

  // Build workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NeuroGlitch Construction Intelligence";
  workbook.created = new Date();

  for (const key of tradeOrder) {
    const group = tradeMap.get(key)!;
    if (group.rows.length === 0) continue;

    // Excel sheet names: max 31 chars, no special chars
    const sheetName = group.tradeName.replace(/[\\/*?:[\]]/g, "").slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    // Build column list: fixed cols + one per sub + fixed tail
    const fixedLeft: Partial<ExcelJS.Column>[] = [
      { header: "Scope Item", key: "scopeText", width: 52 },
      { header: "Division", key: "division", width: 16 },
    ];
    const subCols: Partial<ExcelJS.Column>[] = subList.map((s) => ({
      header: s.label,
      key: s.label,
      width: 10,
    }));
    const fixedRight: Partial<ExcelJS.Column>[] = [
      { header: "Status", key: "status", width: 16 },
      { header: "Notes", key: "notes", width: 32 },
    ];
    sheet.columns = [...fixedLeft, ...subCols, ...fixedRight];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = HEADER_FILL;
    headerRow.alignment = { vertical: "middle" };

    // Freeze header row
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    // Auto-filter spanning all columns
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: fixedLeft.length + subCols.length + fixedRight.length },
    };

    // Add data rows
    for (const row of group.rows) {
      const rowData: Record<string, string> = {
        scopeText: row.scopeText,
        division: row.division,
        status: STATUS_LABELS[row.status] ?? row.status,
        notes: row.note ?? "",
      };

      for (const sub of subList) {
        rowData[sub.label] = row.estimateUploadId === sub.estimateUploadId ? "✓" : "";
      }

      const dataRow = sheet.addRow(rowData);
      dataRow.alignment = { wrapText: true, vertical: "top" };

      // Align sub checkmark columns to center
      for (let i = 0; i < subList.length; i++) {
        const colIdx = fixedLeft.length + i + 1;
        dataRow.getCell(colIdx).alignment = { horizontal: "center", vertical: "top" };
      }

      // Row highlight by status
      if (row.status === "clarification_needed") {
        dataRow.fill = YELLOW_FILL;
      } else if (row.status === "excluded") {
        dataRow.fill = RED_FILL;
      }
    }
  }

  // If nothing to export, add a placeholder sheet
  if (workbook.worksheets.length === 0) {
    const sheet = workbook.addWorksheet("Leveling");
    sheet.addRow([
      "No reviewed scope lines found. Upload estimates and open the Leveling tab to populate.",
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `leveling-bid-${bidId}-${dateStr}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
