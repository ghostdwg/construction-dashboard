// POST /api/bids/[id]/handoff/export
//
// Generates a 5-sheet XLSX handoff packet for download:
//   1. Project Summary  — bid info, intake context, constraints, compliance
//   2. Trade Awards     — trade by trade, with awarded sub + contact + status
//   3. Open Items       — open RFIs, unresolved assumptions, risk flags
//   4. Contacts         — awarded sub contacts (owner/architect deferred)
//   5. Documents        — uploaded spec books, drawings, addendums
//
// Pricing boundary: per-trade dollar amounts are LEFT BLANK in this module.
// Module H2 (Buyout Tracker) will populate them. The total ourBidAmount is
// shown on the Project Summary sheet (single field, not per-trade).

import ExcelJS from "exceljs";
import {
  assembleHandoffPacket,
  type HandoffPacket,
} from "@/lib/services/handoff/assembleHandoffPacket";

// ── Style helpers ──────────────────────────────────────────────────────────

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE4E4E7" }, // zinc-200
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FF18181B" }, // zinc-900
};

const SECTION_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF4F4F5" }, // zinc-100
};

const SECTION_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  color: { argb: "FF18181B" },
};

function applyHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF18181B" } },
    };
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function fmtBool(v: boolean): string {
  return v ? "Yes" : "No";
}

const DELIVERY_LABELS: Record<string, string> = {
  HARD_BID: "Hard Bid",
  DESIGN_BUILD: "Design-Build",
  CM_AT_RISK: "CM at Risk",
  NEGOTIATED: "Negotiated",
};
const OWNER_LABELS: Record<string, string> = {
  PUBLIC_ENTITY: "Public Entity",
  PRIVATE_OWNER: "Private Owner",
  DEVELOPER: "Developer",
  INSTITUTIONAL: "Institutional",
};

// ── Sheet builders ─────────────────────────────────────────────────────────

function buildProjectSummarySheet(wb: ExcelJS.Workbook, p: HandoffPacket) {
  const sheet = wb.addWorksheet("Project Summary");
  sheet.columns = [
    { header: "", key: "label", width: 28 },
    { header: "", key: "value", width: 56 },
  ];

  type SectionRow = { section?: string; label?: string; value?: string };
  const rows: SectionRow[] = [
    { section: "Project Identity" },
    { label: "Project Name", value: p.project.name },
    { label: "Bid Number", value: p.project.number },
    { label: "Location", value: p.project.location ?? "—" },
    { label: "Due Date", value: fmtDate(p.project.dueDate) },
    { label: "Project Type", value: p.project.projectType },
    { label: "Status", value: p.status.toUpperCase() },
    { label: "Total Bid Amount", value: p.project.ourBidAmount != null ? `$${p.project.ourBidAmount.toLocaleString()}` : "—" },

    { section: "Project Profile" },
    { label: "Delivery Method", value: p.project.deliveryMethod ? (DELIVERY_LABELS[p.project.deliveryMethod] ?? p.project.deliveryMethod) : "—" },
    { label: "Owner Type", value: p.project.ownerType ? (OWNER_LABELS[p.project.ownerType] ?? p.project.ownerType) : "—" },
    { label: "Building Type", value: p.project.buildingType ?? "—" },
    { label: "Approx. Square Feet", value: p.project.approxSqft != null ? p.project.approxSqft.toLocaleString() : "—" },
    { label: "Stories", value: p.project.stories != null ? String(p.project.stories) : "—" },

    { section: "Constraints" },
    { label: "Occupied Space", value: fmtBool(p.constraints.occupiedSpace) },
    { label: "Phasing Required", value: fmtBool(p.constraints.phasingRequired) },
    { label: "VE Interest", value: fmtBool(p.constraints.veInterest) },
    { label: "Site Constraints", value: p.constraints.siteConstraints ?? "—" },
    { label: "Scope Boundary Notes", value: p.constraints.scopeBoundaryNotes ?? "—" },
    { label: "Estimator Notes", value: p.constraints.estimatorNotes ?? "—" },
  ];

  if (p.project.projectType === "PUBLIC") {
    rows.push(
      { section: "Public Bid Terms" },
      { label: "LD Per Day", value: p.constraints.ldAmountPerDay != null ? `$${p.constraints.ldAmountPerDay.toLocaleString()}` : "—" },
      { label: "LD Cap", value: p.constraints.ldCapAmount != null ? `$${p.constraints.ldCapAmount.toLocaleString()}` : "—" },
      { label: "DBE Goal", value: p.constraints.dbeGoalPercent != null ? `${p.constraints.dbeGoalPercent}%` : "—" }
    );

    if (p.complianceStatus) {
      rows.push(
        { section: "Compliance Status" },
        { label: "Items Complete", value: `${p.complianceStatus.checkedItems} of ${p.complianceStatus.totalItems} (${p.complianceStatus.percentComplete}%)` }
      );
      for (const item of p.complianceStatus.items) {
        rows.push({
          label: `  ${item.label}`,
          value: item.checked ? "✓ Complete" : "○ Pending",
        });
      }
    }
  }

  // Render section headers and label/value pairs
  for (const row of rows) {
    if (row.section) {
      const r = sheet.addRow([row.section, ""]);
      r.eachCell((cell) => {
        cell.fill = SECTION_FILL;
        cell.font = SECTION_FONT;
      });
      sheet.mergeCells(`A${r.number}:B${r.number}`);
    } else {
      const r = sheet.addRow([row.label ?? "", row.value ?? ""]);
      r.getCell(1).font = { bold: true, color: { argb: "FF52525B" } };
      r.getCell(1).alignment = { vertical: "top" };
      r.getCell(2).alignment = { vertical: "top", wrapText: true };
    }
  }

  sheet.views = [{ state: "frozen", xSplit: 1 }];
}

function buildTradeAwardsSheet(wb: ExcelJS.Workbook, p: HandoffPacket) {
  const sheet = wb.addWorksheet("Trade Awards");
  sheet.columns = [
    { header: "Trade", key: "trade", width: 30 },
    { header: "CSI Code", key: "csi", width: 12 },
    { header: "Tier", key: "tier", width: 8 },
    { header: "Awarded Sub", key: "sub", width: 30 },
    { header: "Contact", key: "contact", width: 22 },
    { header: "Email", key: "email", width: 28 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Contract Status", key: "status", width: 18 },
  ];
  applyHeader(sheet.getRow(1));

  for (const t of p.trades) {
    const r = sheet.addRow({
      trade: t.tradeName,
      csi: t.csiCode ?? "—",
      tier: t.tier.replace("TIER", "T"),
      sub: t.awardedSubName ?? "(not yet awarded)",
      contact: t.awardedContactName ?? "—",
      email: t.awardedContactEmail ?? "—",
      phone: t.awardedContactPhone ?? "—",
      amount: t.bidAmount != null ? `$${t.bidAmount.toLocaleString()}` : "— (H2)",
      status: t.contractStatus,
    });
    if (!t.awardedSubName) {
      r.eachCell((cell) => {
        cell.font = { color: { argb: "FF71717A" }, italic: true };
      });
    }
  }

  // Note row at bottom
  sheet.addRow([]);
  const noteRow = sheet.addRow([
    "Note: Per-trade dollar amounts will populate when Module H2 (Buyout Tracker) ships.",
  ]);
  sheet.mergeCells(`A${noteRow.number}:I${noteRow.number}`);
  noteRow.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildOpenItemsSheet(wb: ExcelJS.Workbook, p: HandoffPacket) {
  const sheet = wb.addWorksheet("Open Items");
  sheet.columns = [
    { header: "", key: "a", width: 14 },
    { header: "", key: "b", width: 60 },
    { header: "", key: "c", width: 18 },
    { header: "", key: "d", width: 14 },
  ];

  // ── Open RFIs ──
  let r = sheet.addRow(["Open RFIs", "", "", ""]);
  r.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${r.number}:D${r.number}`);

  if (p.openItems.unresolvedRfis.length === 0) {
    r = sheet.addRow(["", "(none)", "", ""]);
    r.getCell(2).font = { italic: true, color: { argb: "FF71717A" } };
  } else {
    r = sheet.addRow(["RFI #", "Question", "Trade", "Status"]);
    applyHeader(r);
    for (const rfi of p.openItems.unresolvedRfis) {
      const dataRow = sheet.addRow([
        rfi.rfiNumber != null ? `RFI-${String(rfi.rfiNumber).padStart(3, "0")}` : "—",
        rfi.question,
        rfi.trade ?? "—",
        rfi.status,
      ]);
      dataRow.getCell(2).alignment = { wrapText: true };
    }
  }

  sheet.addRow([]);

  // ── Unresolved Assumptions ──
  r = sheet.addRow(["Unresolved Assumptions", "", "", ""]);
  r.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${r.number}:D${r.number}`);

  if (p.openItems.unresolvedAssumptions.length === 0) {
    r = sheet.addRow(["", "(none)", "", ""]);
    r.getCell(2).font = { italic: true, color: { argb: "FF71717A" } };
  } else {
    r = sheet.addRow(["Urgency", "Assumption", "Source Ref", ""]);
    applyHeader(r);
    for (const a of p.openItems.unresolvedAssumptions) {
      const dataRow = sheet.addRow([a.urgency, a.assumption, a.sourceRef ?? "—", ""]);
      dataRow.getCell(2).alignment = { wrapText: true };
    }
  }

  sheet.addRow([]);

  // ── Risk Flags ──
  r = sheet.addRow(["Risk Flags", "", "", ""]);
  r.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${r.number}:D${r.number}`);

  if (p.riskFlags.length === 0) {
    r = sheet.addRow(["", "(none — no brief generated yet, or no risks flagged)", "", ""]);
    r.getCell(2).font = { italic: true, color: { argb: "FF71717A" } };
  } else {
    r = sheet.addRow(["Severity", "Risk Flag", "Found In", "Action"]);
    applyHeader(r);
    for (const f of p.riskFlags) {
      const dataRow = sheet.addRow([
        f.severity.toUpperCase(),
        f.flag,
        f.foundIn ?? "—",
        f.recommendedAction ?? "—",
      ]);
      dataRow.getCell(2).alignment = { wrapText: true };
      dataRow.getCell(4).alignment = { wrapText: true };
      if (f.severity === "critical") {
        dataRow.getCell(1).font = { bold: true, color: { argb: "FFB91C1C" } };
      }
    }
  }
}

function buildContactsSheet(wb: ExcelJS.Workbook, p: HandoffPacket) {
  const sheet = wb.addWorksheet("Contacts");
  sheet.columns = [
    { header: "Company", key: "company", width: 30 },
    { header: "Contact", key: "name", width: 22 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Trades", key: "trades", width: 40 },
  ];

  // Section: Awarded Subs
  const sectionRow = sheet.addRow(["Awarded Subcontractors", "", "", "", ""]);
  sectionRow.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${sectionRow.number}:E${sectionRow.number}`);

  // Header row
  applyHeader(sheet.addRow(["Company", "Contact", "Email", "Phone", "Trades"]));

  if (p.awardedSubs.length === 0) {
    const r = sheet.addRow(["(no awarded subs yet)", "", "", "", ""]);
    r.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
    sheet.mergeCells(`A${r.number}:E${r.number}`);
  } else {
    for (const sub of p.awardedSubs) {
      sheet.addRow([
        sub.companyName,
        sub.contactName ?? "—",
        sub.contactEmail ?? "—",
        sub.contactPhone ?? "—",
        sub.trades.join(", "),
      ]);
    }
  }

  // Note about owner/architect/internal team
  sheet.addRow([]);
  const noteRow = sheet.addRow([
    "Note: Owner, architect, and internal team contacts will populate after a ProjectContact model is added in a future module.",
  ]);
  sheet.mergeCells(`A${noteRow.number}:E${noteRow.number}`);
  noteRow.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
  noteRow.getCell(1).alignment = { wrapText: true };

  sheet.views = [{ state: "frozen", ySplit: 2 }];
}

function buildDocumentsSheet(wb: ExcelJS.Workbook, p: HandoffPacket) {
  const sheet = wb.addWorksheet("Documents");
  sheet.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "File Name", key: "name", width: 50 },
    { header: "Reference", key: "ref", width: 18 },
    { header: "Uploaded", key: "uploaded", width: 18 },
  ];
  applyHeader(sheet.getRow(1));

  if (p.documents.length === 0) {
    const r = sheet.addRow(["(no documents uploaded)", "", "", ""]);
    r.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
    sheet.mergeCells(`A${r.number}:D${r.number}`);
  } else {
    for (const doc of p.documents) {
      sheet.addRow({
        type: doc.type,
        name: doc.fileName,
        ref: doc.reference ?? "—",
        uploaded: fmtDate(doc.uploadedAt),
      });
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  const packet = await assembleHandoffPacket(bidId);
  if (!packet) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Bid Dashboard — Handoff Packet";
  wb.created = new Date();

  buildProjectSummarySheet(wb, packet);
  buildTradeAwardsSheet(wb, packet);
  buildOpenItemsSheet(wb, packet);
  buildContactsSheet(wb, packet);
  buildDocumentsSheet(wb, packet);

  const buffer = await wb.xlsx.writeBuffer();

  // Filename: ProjectName_Handoff_YYYY-MM-DD.xlsx (sanitized)
  const safeName = packet.project.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${safeName}_Handoff_${dateStr}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
