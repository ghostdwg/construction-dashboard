// POST /api/bids/[id]/submittals/export
//
// Exports the submittal register as a CSV in a format compatible with
// Procore's submittal import template. This is also the first piece of
// Tier F (Procore integration bridge) — a zero-setup way to get pursuit-phase
// submittal data into a live Procore project.
//
// Procore submittal import columns (as of their current template):
//   Number, Title, Spec Section, Responsible Contractor, Submittal Manager,
//   Received From, Type, Status, Required On-Site Date, Description
//
// Values we can't derive are left blank. The user re-imports the CSV into
// Procore via Admin → Submittals → Import.

import { loadSubmittalsForBid } from "@/lib/services/submittal/submittalService";

// ── CSV helpers ────────────────────────────────────────────────────────────

function csvEscape(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(values: Array<string | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

// ── Type + status mapping to Procore vocabulary ────────────────────────────

// Procore's default submittal types (closest analogs)
const TYPE_TO_PROCORE: Record<string, string> = {
  PRODUCT_DATA: "Product Data",
  SHOP_DRAWING: "Shop Drawings",
  SAMPLE: "Sample",
  MOCKUP: "Mock-Up",
  WARRANTY: "Warranty",
  O_AND_M: "Operation and Maintenance Manual",
  LEED: "LEED",
  CERT: "Certificate",
  OTHER: "Other",
};

// Procore's default submittal statuses
const STATUS_TO_PROCORE: Record<string, string> = {
  PENDING: "Draft",
  REQUESTED: "Open",
  RECEIVED: "Open",
  UNDER_REVIEW: "Open",
  APPROVED: "Closed",
  APPROVED_AS_NOTED: "Closed",
  REJECTED: "Revise and Resubmit",
  RESUBMIT: "Revise and Resubmit",
};

function fmtIsoDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
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

  try {
    const items = await loadSubmittalsForBid(bidId);

    const header = [
      "Package",
      "Number",
      "Title",
      "Spec Section",
      "Responsible Contractor",
      "Submittal Manager",
      "Received From",
      "Type",
      "Status",
      "Submit By Date",
      "Required On-Site Date",
      "Description",
    ];

    const rows = [toCsvRow(header)];
    for (const item of items) {
      rows.push(
        toCsvRow([
          item.packageNumber,
          item.submittalNumber,
          item.title,
          item.specSectionNumber,
          item.responsibleSubName,
          "",
          "",
          TYPE_TO_PROCORE[item.type] ?? "Other",
          STATUS_TO_PROCORE[item.status] ?? "Draft",
          fmtIsoDate(item.submitByDate),
          fmtIsoDate(item.requiredOnSiteDate),
          item.description,
        ])
      );
    }

    const csv = "\uFEFF" + rows.join("\r\n") + "\r\n";
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Submittals_Bid${bidId}_${dateStr}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[POST /api/bids/:id/submittals/export]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
