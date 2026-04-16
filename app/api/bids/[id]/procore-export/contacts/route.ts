// GET /api/bids/[id]/procore-export/contacts
//
// Exports project team contacts (H1+) as a CSV for Procore's People Directory
// import. Covers the owner, architect, engineer, and internal team entries
// stored in ProjectContact.
//
// Procore People Directory import columns (Admin → Company → People → Import):
//   First Name, Last Name, Email Address, Business Phone, Cell Phone,
//   Job Title, Company, Notes

import { prisma } from "@/lib/prisma";

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

// Best-effort name split: everything before the last word is first name,
// the last word is last name. Handles "John Smith" → ["John", "Smith"] and
// "Mary Jo Williams" → ["Mary Jo", "Williams"]. Single-word names go into
// last name only (common for org contacts with just a company/role handle).
function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return ["", parts[0]];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

// Human-readable role for the Notes column
const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  OWNER_REP: "Owner's Representative",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  INTERNAL_PM: "GC Project Manager",
  INTERNAL_ESTIMATOR: "GC Estimator",
  INTERNAL_SUPER: "GC Superintendent",
  OTHER: "Contact",
};

// ── Handler ────────────────────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, projectName: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const contacts = await prisma.projectContact.findMany({
    where: { bidId },
    orderBy: [{ role: "asc" }, { isPrimary: "desc" }, { name: "asc" }],
  });

  if (contacts.length === 0) {
    return Response.json({ error: "No project contacts found for this bid" }, { status: 404 });
  }

  const header = toCsvRow([
    "First Name", "Last Name", "Email Address", "Business Phone",
    "Cell Phone", "Job Title", "Company", "Notes",
  ]);

  const rows = [header];
  for (const c of contacts) {
    const [firstName, lastName] = splitName(c.name);
    const roleLabel = ROLE_LABELS[c.role] ?? c.role;
    rows.push(
      toCsvRow([
        firstName,
        lastName,
        c.email,
        c.phone,
        null,        // Cell Phone — not tracked separately
        c.title,
        c.company,
        roleLabel,
      ])
    );
  }

  const safeName = (bid.projectName ?? "project")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();

  return new Response(rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="procore-contacts-${safeName}.csv"`,
    },
  });
}
