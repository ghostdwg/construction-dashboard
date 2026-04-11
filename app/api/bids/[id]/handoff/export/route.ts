// POST /api/bids/[id]/handoff/export
//
// Generates an 8-sheet XLSX handoff packet for download:
//   1. Project Summary  — bid info, intake context, constraints, compliance
//   2. Trade Awards     — trade by trade, committed amount + contract status (H2)
//   3. Buyout Summary   — rollup + per-trade financial detail (H2)
//   4. Submittals       — submittal register (H3)
//   5. Schedule         — seeded project schedule (H4)
//   6. Open Items       — open RFIs, unresolved assumptions, risk flags
//   7. Contacts         — project team + awarded subs (H1+)
//   8. Documents        — uploaded spec books, drawings, addendums
//
// Pricing boundary: committedAmount / paidToDate are OUTBOUND commitments.
// EstimateUpload.pricingData is never touched.

import ExcelJS from "exceljs";
import {
  assembleHandoffPacket,
  type HandoffPacket,
} from "@/lib/services/handoff/assembleHandoffPacket";
import {
  loadBuyoutItemsForBid,
  type BuyoutItemRow,
} from "@/lib/services/buyout/buyoutService";
import {
  loadSubmittalsForBid,
  type SubmittalRow,
} from "@/lib/services/submittal/submittalService";
import {
  loadScheduleForBid,
  type ScheduleActivityRow,
} from "@/lib/services/schedule/scheduleService";

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

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  LOI_SENT: "LOI Sent",
  CONTRACT_SENT: "Contract Sent",
  CONTRACT_SIGNED: "Contract Signed",
  PO_ISSUED: "PO Issued",
  ACTIVE: "Active",
  CLOSED: "Closed",
};

const SUBMITTAL_TYPE_LABELS: Record<string, string> = {
  PRODUCT_DATA: "Product Data",
  SHOP_DRAWING: "Shop Drawings",
  SAMPLE: "Sample",
  MOCKUP: "Mock-Up",
  WARRANTY: "Warranty",
  O_AND_M: "O&M Manual",
  LEED: "LEED Doc",
  CERT: "Certificate",
  OTHER: "Other",
};

const SUBMITTAL_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  REQUESTED: "Requested",
  RECEIVED: "Received",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  APPROVED_AS_NOTED: "Approved as Noted",
  REJECTED: "Rejected",
  RESUBMIT: "Resubmit",
};

function fmtDollar(n: number | null | undefined): string {
  if (n == null || n === 0) return n === 0 ? "$0" : "—";
  return `$${Math.round(n).toLocaleString()}`;
}

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

  // Buyout rollup (H2)
  rows.push(
    { section: "Buyout Rollup" },
    { label: "Trades Committed", value: `${p.buyoutRollup.tradesCommitted} of ${p.buyoutRollup.tradeCount}` },
    { label: "Total Committed", value: fmtDollar(p.buyoutRollup.totalCommitted) },
    { label: "Paid to Date", value: fmtDollar(p.buyoutRollup.totalPaid) },
    { label: "Remaining", value: fmtDollar(p.buyoutRollup.totalRemaining) },
    { label: "Retainage Held", value: fmtDollar(p.buyoutRollup.totalRetainageHeld) }
  );

  // Submittal register rollup (H3)
  const subR = p.submittalRollup;
  const subPending = subR.byStatus.PENDING + subR.byStatus.REQUESTED;
  const subInReview = subR.byStatus.RECEIVED + subR.byStatus.UNDER_REVIEW;
  const subApproved = subR.byStatus.APPROVED + subR.byStatus.APPROVED_AS_NOTED;
  rows.push(
    { section: "Submittal Register" },
    { label: "Total", value: String(subR.total) },
    { label: "Pending", value: String(subPending) },
    { label: "In Review", value: String(subInReview) },
    { label: "Approved", value: String(subApproved) },
    { label: "Overdue", value: String(subR.overdue) }
  );

  // Schedule summary (H4)
  const sched = p.scheduleSummary;
  rows.push(
    { section: "Project Schedule" },
    { label: "Construction Start", value: fmtDate(sched.constructionStartDate) },
    { label: "Substantial Completion", value: fmtDate(sched.computedFinishDate) },
    { label: "Total Duration", value: sched.projectDurationDays != null ? `${sched.projectDurationDays} working days` : "—" },
    { label: "Activities", value: `${sched.constructionCount} construction · ${sched.milestoneCount} milestones` }
  );

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
    { header: "Committed", key: "amount", width: 14 },
    { header: "Contract Status", key: "status", width: 18 },
  ];
  applyHeader(sheet.getRow(1));

  let total = 0;
  for (const t of p.trades) {
    if (t.bidAmount != null) total += t.bidAmount;
    const r = sheet.addRow({
      trade: t.tradeName,
      csi: t.csiCode ?? "—",
      tier: t.tier.replace("TIER", "T"),
      sub: t.awardedSubName ?? "(not yet awarded)",
      contact: t.awardedContactName ?? "—",
      email: t.awardedContactEmail ?? "—",
      phone: t.awardedContactPhone ?? "—",
      amount: fmtDollar(t.bidAmount),
      status: CONTRACT_STATUS_LABELS[t.contractStatus] ?? t.contractStatus,
    });
    r.getCell("amount").alignment = { horizontal: "right" };
    if (!t.awardedSubName) {
      r.eachCell((cell) => {
        cell.font = { color: { argb: "FF71717A" }, italic: true };
      });
    }
  }

  // Total row
  const totalRow = sheet.addRow({
    trade: "Total committed",
    csi: "",
    tier: "",
    sub: "",
    contact: "",
    email: "",
    phone: "",
    amount: fmtDollar(total),
    status: "",
  });
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = SECTION_FILL;
  });
  totalRow.getCell("amount").alignment = { horizontal: "right" };

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildBuyoutSummarySheet(wb: ExcelJS.Workbook, items: BuyoutItemRow[]) {
  const sheet = wb.addWorksheet("Buyout Summary");
  sheet.columns = [
    { header: "Trade", key: "trade", width: 30 },
    { header: "Awarded Sub", key: "sub", width: 28 },
    { header: "Status", key: "status", width: 16 },
    { header: "PO #", key: "po", width: 14 },
    { header: "Committed", key: "committed", width: 14 },
    { header: "Change Orders", key: "co", width: 14 },
    { header: "Total w/ COs", key: "total", width: 14 },
    { header: "Paid", key: "paid", width: 14 },
    { header: "Remaining", key: "remaining", width: 14 },
    { header: "Retainage", key: "retainage", width: 14 },
  ];
  applyHeader(sheet.getRow(1));

  let tCommitted = 0;
  let tCO = 0;
  let tTotal = 0;
  let tPaid = 0;
  let tRemaining = 0;
  let tRetainage = 0;

  for (const it of items) {
    tCommitted += it.committedAmount ?? 0;
    tCO += it.changeOrderAmount;
    tTotal += it.totalCommitted;
    tPaid += it.paidToDate;
    tRemaining += it.remainingToPay;
    tRetainage += it.retainageHeld;

    const r = sheet.addRow({
      trade: it.tradeName,
      sub: it.subcontractorName ?? "(not yet awarded)",
      status: CONTRACT_STATUS_LABELS[it.contractStatus] ?? it.contractStatus,
      po: it.poNumber ?? "—",
      committed: fmtDollar(it.committedAmount),
      co: fmtDollar(it.changeOrderAmount),
      total: fmtDollar(it.totalCommitted),
      paid: fmtDollar(it.paidToDate),
      remaining: fmtDollar(it.remainingToPay),
      retainage: fmtDollar(it.retainageHeld),
    });
    for (const key of ["committed", "co", "total", "paid", "remaining", "retainage"]) {
      r.getCell(key).alignment = { horizontal: "right" };
    }
    if (!it.subcontractorName) {
      r.eachCell((cell) => {
        if (cell.font?.italic) return;
        cell.font = { color: { argb: "FF71717A" }, italic: true };
      });
    }
  }

  // Total row
  const totalRow = sheet.addRow({
    trade: "Totals",
    sub: "",
    status: "",
    po: "",
    committed: fmtDollar(tCommitted),
    co: fmtDollar(tCO),
    total: fmtDollar(tTotal),
    paid: fmtDollar(tPaid),
    remaining: fmtDollar(tRemaining),
    retainage: fmtDollar(tRetainage),
  });
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = SECTION_FILL;
  });
  for (const key of ["committed", "co", "total", "paid", "remaining", "retainage"]) {
    totalRow.getCell(key).alignment = { horizontal: "right" };
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildSubmittalsSheet(wb: ExcelJS.Workbook, items: SubmittalRow[]) {
  const sheet = wb.addWorksheet("Submittals");
  sheet.columns = [
    { header: "Number", key: "number", width: 14 },
    { header: "Title", key: "title", width: 40 },
    { header: "Spec Section", key: "spec", width: 14 },
    { header: "Type", key: "type", width: 16 },
    { header: "Responsible", key: "responsible", width: 26 },
    { header: "Status", key: "status", width: 18 },
    { header: "Required By", key: "required", width: 14 },
    { header: "Reviewer", key: "reviewer", width: 22 },
  ];
  applyHeader(sheet.getRow(1));

  if (items.length === 0) {
    const r = sheet.addRow(["(no submittals — run Seed from Specs on the Submittals tab)", "", "", "", "", "", "", ""]);
    r.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
    sheet.mergeCells(`A${r.number}:H${r.number}`);
  } else {
    for (const item of items) {
      const isOverdue = item.isOverdue;
      const r = sheet.addRow({
        number: item.submittalNumber ?? "—",
        title: item.title,
        spec: item.specSectionNumber ?? "—",
        type: SUBMITTAL_TYPE_LABELS[item.type] ?? item.type,
        responsible: item.responsibleSubName ?? "(unassigned)",
        status: SUBMITTAL_STATUS_LABELS[item.status] ?? item.status,
        required: fmtDate(item.requiredBy),
        reviewer: item.reviewer ?? "—",
      });
      r.getCell("title").alignment = { wrapText: true };
      if (isOverdue) {
        r.getCell("required").font = { bold: true, color: { argb: "FFB91C1C" } };
      }
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildScheduleSheet(wb: ExcelJS.Workbook, activities: ScheduleActivityRow[]) {
  const sheet = wb.addWorksheet("Schedule");
  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Activity Name", key: "name", width: 36 },
    { header: "Duration (d)", key: "duration", width: 12 },
    { header: "Start", key: "start", width: 14 },
    { header: "Finish", key: "finish", width: 14 },
    { header: "Predecessors", key: "predecessors", width: 20 },
    { header: "Trade", key: "trade", width: 24 },
  ];
  applyHeader(sheet.getRow(1));

  if (activities.length === 0) {
    const r = sheet.addRow(["(no activities — run Seed from Trades on the Schedule tab)", "", "", "", "", "", ""]);
    r.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
    sheet.mergeCells(`A${r.number}:G${r.number}`);
  } else {
    for (const a of activities) {
      const isMilestone = a.kind === "MILESTONE";
      const r = sheet.addRow({
        id: a.activityId,
        name: (isMilestone ? "◆ " : "") + a.name,
        duration: isMilestone ? 0 : a.durationDays,
        start: fmtDate(a.startDate),
        finish: fmtDate(a.finishDate),
        predecessors: a.predecessorIds.join(","),
        trade: a.tradeName ?? "—",
      });
      r.getCell("name").alignment = { wrapText: true };
      if (isMilestone) {
        r.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FF4338CA" } }; // indigo-700
        });
      }
    }
  }

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

const CONTACT_ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  OWNER_REP: "Owner's Rep",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  INTERNAL_PM: "Internal — PM",
  INTERNAL_ESTIMATOR: "Internal — Estimator",
  INTERNAL_SUPER: "Internal — Superintendent",
  OTHER: "Other",
};

function buildContactsSheet(wb: ExcelJS.Workbook, p: HandoffPacket) {
  const sheet = wb.addWorksheet("Contacts");
  sheet.columns = [
    { header: "", key: "role", width: 22 },
    { header: "", key: "name", width: 24 },
    { header: "", key: "title", width: 22 },
    { header: "", key: "company", width: 28 },
    { header: "", key: "email", width: 30 },
    { header: "", key: "phone", width: 16 },
  ];

  // ── Section 1: Owner & Project Team (H1 ProjectContact rows) ─────────────
  const teamSection = sheet.addRow(["Owner & Project Team", "", "", "", "", ""]);
  teamSection.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${teamSection.number}:F${teamSection.number}`);

  applyHeader(
    sheet.addRow(["Role", "Name", "Title", "Company", "Email", "Phone"])
  );

  if (p.projectContacts.length === 0) {
    const r = sheet.addRow([
      "(no project contacts captured yet — add them on the Overview or Handoff tab)",
      "", "", "", "", "",
    ]);
    r.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
    r.getCell(1).alignment = { wrapText: true };
    sheet.mergeCells(`A${r.number}:F${r.number}`);
  } else {
    for (const c of p.projectContacts) {
      const namePrefix = c.isPrimary ? "★ " : "";
      sheet.addRow({
        role: CONTACT_ROLE_LABELS[c.role] ?? c.role,
        name: namePrefix + c.name,
        title: c.title ?? "—",
        company: c.company ?? "—",
        email: c.email ?? "—",
        phone: c.phone ?? "—",
      });
    }
  }

  // Spacer
  sheet.addRow([]);

  // ── Section 2: Awarded Subcontractors (existing) ─────────────────────────
  const subsSection = sheet.addRow(["Awarded Subcontractors", "", "", "", "", ""]);
  subsSection.eachCell((cell) => { cell.fill = SECTION_FILL; cell.font = SECTION_FONT; });
  sheet.mergeCells(`A${subsSection.number}:F${subsSection.number}`);

  applyHeader(
    sheet.addRow(["", "Company", "Contact", "Trades", "Email", "Phone"])
  );

  if (p.awardedSubs.length === 0) {
    const r = sheet.addRow(["", "(no awarded subs yet)", "", "", "", ""]);
    r.getCell(2).font = { italic: true, color: { argb: "FF71717A" } };
  } else {
    for (const sub of p.awardedSubs) {
      sheet.addRow([
        "",
        sub.companyName,
        sub.contactName ?? "—",
        sub.trades.join(", "),
        sub.contactEmail ?? "—",
        sub.contactPhone ?? "—",
      ]);
    }
  }

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

  // H2 — load buyout items directly for the dedicated Buyout Summary sheet.
  const buyoutItems = await loadBuyoutItemsForBid(bidId);

  // H3 — load submittal register rows for the dedicated Submittals sheet.
  const submittalItems = await loadSubmittalsForBid(bidId);

  // H4 — load schedule activities for the dedicated Schedule sheet.
  const { activities: scheduleActivities } = await loadScheduleForBid(bidId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Bid Dashboard — Handoff Packet";
  wb.created = new Date();

  buildProjectSummarySheet(wb, packet);
  buildTradeAwardsSheet(wb, packet);
  buildBuyoutSummarySheet(wb, buyoutItems);
  buildSubmittalsSheet(wb, submittalItems);
  buildScheduleSheet(wb, scheduleActivities);
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
