// POST /api/bids/[id]/budget/export
//
// Module H6 — Budget XLSX export. Single sheet with trade lines + GC lines +
// grand total in a format accountants/PMs expect for ERP import.

import ExcelJS from "exceljs";
import {
  assembleBudget,
  type ProjectBudget,
} from "@/lib/services/budget/assembleBudget";

const HEADER_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FF18181B" } };
const SECTION_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
const SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11, color: { argb: "FF18181B" } };
const TOTAL_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
const TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };

function fmtDollar(n: number): string {
  if (n === 0) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

function buildBudgetSheet(wb: ExcelJS.Workbook, budget: ProjectBudget) {
  const sheet = wb.addWorksheet("Project Budget");
  sheet.columns = [
    { key: "code", width: 12 },
    { key: "csi", width: 12 },
    { key: "description", width: 36 },
    { key: "sub", width: 28 },
    { key: "committed", width: 14 },
    { key: "co", width: 14 },
    { key: "total", width: 14 },
  ];

  // Title
  const titleRow = sheet.addRow(["PROJECT BUDGET", "", "", "", "", "", ""]);
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF18181B" } };
  sheet.mergeCells(`A${titleRow.number}:G${titleRow.number}`);

  const dateRow = sheet.addRow([
    `${budget.project.name} — ${budget.project.number}`,
    "", "", "", "", "", "",
  ]);
  dateRow.getCell(1).font = { size: 10, italic: true, color: { argb: "FF71717A" } };
  sheet.mergeCells(`A${dateRow.number}:G${dateRow.number}`);

  if (budget.project.location) {
    const locRow = sheet.addRow([budget.project.location, "", "", "", "", "", ""]);
    locRow.getCell(1).font = { size: 10, color: { argb: "FF71717A" } };
    sheet.mergeCells(`A${locRow.number}:G${locRow.number}`);
  }

  sheet.addRow([]);

  // ── Trade Lines ──────────────────────────────────────────────────────
  const tradeSec = sheet.addRow(["Trade Costs", "", "", "", "", "", ""]);
  tradeSec.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${tradeSec.number}:G${tradeSec.number}`);

  const tradeHeader = sheet.addRow(["Cost Code", "CSI", "Trade", "Subcontractor", "Committed", "Change Orders", "Total"]);
  tradeHeader.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF18181B" } } };
  });
  for (const key of ["committed", "co", "total"]) {
    tradeHeader.getCell(key).alignment = { horizontal: "right", vertical: "middle" };
  }

  for (const t of budget.tradeLines) {
    const r = sheet.addRow({
      code: t.costCode ?? "—",
      csi: t.csiCode ?? "—",
      description: t.tradeName,
      sub: t.subcontractorName ?? "(unassigned)",
      committed: fmtDollar(t.committedAmount),
      co: fmtDollar(t.changeOrderAmount),
      total: fmtDollar(t.totalAmount),
    });
    for (const key of ["committed", "co", "total"]) {
      r.getCell(key).alignment = { horizontal: "right" };
    }
    if (!t.subcontractorName) {
      r.getCell("sub").font = { italic: true, color: { argb: "FF71717A" } };
    }
  }

  const tradeSubRow = sheet.addRow({
    code: "", csi: "", description: "Trade Subtotal",
    sub: "", committed: "", co: "", total: fmtDollar(budget.tradeSubtotal),
  });
  tradeSubRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = SECTION_FILL; });
  tradeSubRow.getCell("total").alignment = { horizontal: "right" };

  sheet.addRow([]);

  // ── GC / General Requirements ────────────────────────────────────────
  const gcSec = sheet.addRow(["GC / General Requirements", "", "", "", "", "", ""]);
  gcSec.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${gcSec.number}:G${gcSec.number}`);

  const gcHeader = sheet.addRow(["Cost Code", "", "Description", "", "", "", "Amount"]);
  gcHeader.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF18181B" } } };
  });
  gcHeader.getCell("total").alignment = { horizontal: "right", vertical: "middle" };

  for (const g of budget.gcLines) {
    const r = sheet.addRow({
      code: g.costCode,
      csi: "",
      description: g.label,
      sub: "",
      committed: "",
      co: "",
      total: fmtDollar(g.amount),
    });
    r.getCell("total").alignment = { horizontal: "right" };
  }

  const gcSubRow = sheet.addRow({
    code: "", csi: "", description: "GC Subtotal",
    sub: "", committed: "", co: "", total: fmtDollar(budget.gcSubtotal),
  });
  gcSubRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = SECTION_FILL; });
  gcSubRow.getCell("total").alignment = { horizontal: "right" };

  sheet.addRow([]);

  // ── Grand Total ──────────────────────────────────────────────────────
  const totalRow = sheet.addRow({
    code: "", csi: "", description: "GRAND TOTAL",
    sub: "", committed: "", co: "", total: fmtDollar(budget.grandTotal),
  });
  totalRow.eachCell((cell) => { cell.fill = TOTAL_FILL; cell.font = TOTAL_FONT; });
  totalRow.getCell("total").alignment = { horizontal: "right" };

  sheet.views = [{ state: "frozen", ySplit: 6 }];
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const budget = await assembleBudget(bidId);
    if (!budget) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Construction Dashboard — Project Budget";
    wb.created = new Date();
    buildBudgetSheet(wb, budget);

    const buffer = await wb.xlsx.writeBuffer();
    const safeName = budget.project.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${safeName}_Budget_${dateStr}.xlsx`;

    return new Response(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[POST /api/bids/:id/budget/export]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
