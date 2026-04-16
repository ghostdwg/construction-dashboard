// POST /api/bids/[id]/owner-estimate/export
//
// Module H5 — Owner-Facing Estimate XLSX export.
//
// Single-sheet professional layout: project identity block, trade-level cost
// table, GC markup line items, contingency, grand total, exclusions +
// qualifications, and validity note.
//
// Privacy boundary: no sub names, no contract status, no internal buyout
// detail. Trade name + CSI code + committed amount only.

import ExcelJS from "exceljs";
import {
  assembleOwnerEstimate,
  type OwnerEstimateInput,
  type OwnerEstimate,
} from "@/lib/services/ownerEstimate/assembleOwnerEstimate";

// ── Styles ─────────────────────────────────────────────────────────────────

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE4E4E7" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FF18181B" },
};
const SECTION_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF4F4F5" },
};
const SECTION_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  color: { argb: "FF18181B" },
};
const TOTAL_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF18181B" },
};
const TOTAL_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 12,
  color: { argb: "FFFFFFFF" },
};

function fmtDollar(n: number): string {
  if (n === 0) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── Sheet builder ──────────────────────────────────────────────────────────

function buildOwnerEstimateSheet(wb: ExcelJS.Workbook, est: OwnerEstimate) {
  const sheet = wb.addWorksheet("Owner Estimate");
  sheet.columns = [
    { key: "a", width: 16 },
    { key: "b", width: 40 },
    { key: "c", width: 18 },
  ];

  // ── Project Identity ─────────────────────────────────────────────────
  const titleRow = sheet.addRow(["PROJECT ESTIMATE", "", ""]);
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF18181B" } };
  sheet.mergeCells(`A${titleRow.number}:C${titleRow.number}`);

  const dateRow = sheet.addRow([`Generated ${fmtDate(est.generatedAt)}`, "", ""]);
  dateRow.getCell(1).font = { size: 10, italic: true, color: { argb: "FF71717A" } };
  sheet.mergeCells(`A${dateRow.number}:C${dateRow.number}`);

  sheet.addRow([]);

  const infoSection = sheet.addRow(["Project Information", "", ""]);
  infoSection.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${infoSection.number}:C${infoSection.number}`);

  const infoRows: [string, string][] = [
    ["Project Name", est.project.name],
    ["Location", est.project.location ?? "—"],
  ];
  if (est.project.deliveryMethod) infoRows.push(["Delivery Method", est.project.deliveryMethod]);
  if (est.project.ownerType) infoRows.push(["Owner Type", est.project.ownerType]);
  if (est.project.buildingType) infoRows.push(["Building Type", est.project.buildingType]);
  if (est.project.approxSqft) infoRows.push(["Approx. Square Feet", est.project.approxSqft.toLocaleString()]);
  if (est.project.stories) infoRows.push(["Stories", String(est.project.stories)]);

  for (const [label, val] of infoRows) {
    const r = sheet.addRow([label, val, ""]);
    r.getCell(1).font = { bold: true, color: { argb: "FF52525B" } };
    sheet.mergeCells(`B${r.number}:C${r.number}`);
  }

  sheet.addRow([]);

  // ── Cost Summary ─────────────────────────────────────────────────────
  const costSection = sheet.addRow(["Cost Summary", "", ""]);
  costSection.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${costSection.number}:C${costSection.number}`);

  const costHeader = sheet.addRow(["CSI Code", "Trade", "Amount"]);
  costHeader.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF18181B" } } };
  });
  costHeader.getCell("c").alignment = { horizontal: "right", vertical: "middle" };

  if (est.trades.length === 0) {
    const r = sheet.addRow(["", "(no trades with committed amounts)", ""]);
    r.getCell(2).font = { italic: true, color: { argb: "FF71717A" } };
  } else {
    for (const t of est.trades) {
      const r = sheet.addRow([t.csiCode ?? "—", t.tradeName, fmtDollar(t.committedAmount)]);
      r.getCell("c").alignment = { horizontal: "right" };
    }
  }

  // Trade subtotal
  const subRow = sheet.addRow(["", "Trade Subtotal", fmtDollar(est.tradeSubtotal)]);
  subRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = SECTION_FILL; });
  subRow.getCell("c").alignment = { horizontal: "right" };

  // Markup lines
  if (est.markupLines.length > 0) {
    sheet.addRow([]);
    for (const m of est.markupLines) {
      const r = sheet.addRow(["", m.label, fmtDollar(m.amount)]);
      r.getCell("c").alignment = { horizontal: "right" };
    }
    const mkRow = sheet.addRow(["", "Subtotal with Markup", fmtDollar(est.subtotalBeforeContingency)]);
    mkRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = SECTION_FILL; });
    mkRow.getCell("c").alignment = { horizontal: "right" };
  }

  // Contingency
  if (est.contingencyPercent > 0) {
    const cRow = sheet.addRow([
      "",
      `Contingency (${est.contingencyPercent}%)`,
      fmtDollar(est.contingencyAmount),
    ]);
    cRow.getCell("c").alignment = { horizontal: "right" };
  }

  // Grand total
  sheet.addRow([]);
  const totalRow = sheet.addRow(["", "TOTAL ESTIMATED COST", fmtDollar(est.grandTotal)]);
  totalRow.eachCell((cell) => { cell.fill = TOTAL_FILL; cell.font = TOTAL_FONT; });
  totalRow.getCell("c").alignment = { horizontal: "right" };

  // ── Exclusions ───────────────────────────────────────────────────────
  if (est.exclusions.trim()) {
    sheet.addRow([]);
    const exSec = sheet.addRow(["Exclusions", "", ""]);
    exSec.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
    sheet.mergeCells(`A${exSec.number}:C${exSec.number}`);
    const exRow = sheet.addRow([est.exclusions, "", ""]);
    exRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
    sheet.mergeCells(`A${exRow.number}:C${exRow.number}`);
  }

  // ── Qualifications ───────────────────────────────────────────────────
  if (est.qualifications.trim()) {
    sheet.addRow([]);
    const qSec = sheet.addRow(["Qualifications", "", ""]);
    qSec.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
    sheet.mergeCells(`A${qSec.number}:C${qSec.number}`);
    const qRow = sheet.addRow([est.qualifications, "", ""]);
    qRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
    sheet.mergeCells(`A${qRow.number}:C${qRow.number}`);
  }

  // ── Validity ─────────────────────────────────────────────────────────
  sheet.addRow([]);
  const validText = est.validUntil
    ? `This estimate is valid until ${fmtDate(est.validUntil)}.`
    : "This estimate is valid for 30 days from the date shown above.";
  const vRow = sheet.addRow([validText, "", ""]);
  vRow.getCell(1).font = { italic: true, color: { argb: "FF71717A" }, size: 10 };
  sheet.mergeCells(`A${vRow.number}:C${vRow.number}`);

  sheet.views = [{ state: "frozen", xSplit: 1 }];
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateInput(body: unknown): {
  ok: true;
  input: OwnerEstimateInput;
} | {
  ok: false;
  error: string;
} {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  const markupLines: Array<{ label: string; amount: number }> = [];
  if (Array.isArray(b.markupLines)) {
    for (const m of b.markupLines) {
      if (
        typeof m === "object" &&
        m !== null &&
        typeof (m as Record<string, unknown>).label === "string" &&
        typeof (m as Record<string, unknown>).amount === "number" &&
        Number.isFinite((m as Record<string, unknown>).amount as number) &&
        ((m as Record<string, unknown>).amount as number) >= 0
      ) {
        markupLines.push({
          label: ((m as Record<string, unknown>).label as string).trim(),
          amount: (m as Record<string, unknown>).amount as number,
        });
      }
    }
  }

  const contingencyPercent =
    typeof b.contingencyPercent === "number" &&
    Number.isFinite(b.contingencyPercent) &&
    b.contingencyPercent >= 0 &&
    b.contingencyPercent <= 100
      ? b.contingencyPercent
      : 0;

  return {
    ok: true,
    input: {
      markupLines,
      contingencyPercent,
      exclusions: typeof b.exclusions === "string" ? b.exclusions : "",
      qualifications: typeof b.qualifications === "string" ? b.qualifications : "",
      validUntil:
        typeof b.validUntil === "string" && b.validUntil.length > 0
          ? b.validUntil
          : null,
    },
  };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateInput(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const estimate = await assembleOwnerEstimate(bidId, validation.input);
    if (!estimate) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Construction Dashboard — Owner Estimate";
    wb.created = new Date();
    buildOwnerEstimateSheet(wb, estimate);

    const buffer = await wb.xlsx.writeBuffer();
    const safeName = estimate.project.name
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 60);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${safeName}_Owner_Estimate_${dateStr}.xlsx`;

    return new Response(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[POST /api/bids/:id/owner-estimate/export]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
