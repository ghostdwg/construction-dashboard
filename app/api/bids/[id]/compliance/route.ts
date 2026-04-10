import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

type ComplianceCategory = "bonding" | "labor" | "dbe" | "documentation";

type ComplianceItem = {
  key: string;
  label: string;
  category: ComplianceCategory;
  checked: boolean;
  note: string | null;
};

// ── Default checklist (seeded on first access) ─────────────────────────────

const DEFAULT_CHECKLIST: ComplianceItem[] = [
  // Bonding
  { key: "bid_bond", label: "Bid bond", category: "bonding", checked: false, note: null },
  { key: "performance_bond", label: "Performance bond", category: "bonding", checked: false, note: null },
  { key: "payment_bond", label: "Payment bond", category: "bonding", checked: false, note: null },
  // Labor
  { key: "prevailing_wage", label: "Prevailing wage / Davis-Bacon", category: "labor", checked: false, note: null },
  { key: "certified_payroll", label: "Certified payroll requirement", category: "labor", checked: false, note: null },
  // DBE
  { key: "dbe_goal", label: "DBE goal identified", category: "dbe", checked: false, note: null },
  { key: "dbe_good_faith", label: "DBE good faith effort documented", category: "dbe", checked: false, note: null },
  { key: "sub_listing", label: "Sub listing requirement met", category: "dbe", checked: false, note: null },
  // Documentation
  { key: "insurance_certs", label: "Insurance certificates", category: "documentation", checked: false, note: null },
  { key: "contractor_license", label: "Contractor license verified", category: "documentation", checked: false, note: null },
  { key: "prequalification", label: "Pre-qualification submitted", category: "documentation", checked: false, note: null },
  { key: "non_collusion", label: "Non-collusion affidavit", category: "documentation", checked: false, note: null },
];

function parseChecklist(raw: string | null): ComplianceItem[] {
  if (!raw) return DEFAULT_CHECKLIST.map((item) => ({ ...item }));
  try {
    const parsed = JSON.parse(raw) as ComplianceItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CHECKLIST.map((item) => ({ ...item }));
    return parsed;
  } catch {
    return DEFAULT_CHECKLIST.map((item) => ({ ...item }));
  }
}

// ── GET /api/bids/[id]/compliance ──────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, projectType: true, complianceChecklist: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const checklist = parseChecklist(bid.complianceChecklist);

  // Seed to DB on first access so it persists
  if (!bid.complianceChecklist) {
    await prisma.bid.update({
      where: { id: bidId },
      data: { complianceChecklist: JSON.stringify(checklist) },
    });
  }

  const total = checklist.length;
  const checked = checklist.filter((c) => c.checked).length;

  return Response.json({
    projectType: bid.projectType,
    checklist,
    summary: { total, checked, unchecked: total - checked },
  });
}

// ── PATCH /api/bids/[id]/compliance ────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json() as {
    key?: string;
    checked?: boolean;
    note?: string | null;
  };

  if (!body.key) {
    return Response.json({ error: "key is required" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, complianceChecklist: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const checklist = parseChecklist(bid.complianceChecklist);
  const item = checklist.find((c) => c.key === body.key);
  if (!item) {
    return Response.json({ error: `Unknown checklist key: ${body.key}` }, { status: 400 });
  }

  if (body.checked !== undefined) item.checked = body.checked;
  if (body.note !== undefined) item.note = body.note;

  await prisma.bid.update({
    where: { id: bidId },
    data: { complianceChecklist: JSON.stringify(checklist) },
  });

  const total = checklist.length;
  const checked = checklist.filter((c) => c.checked).length;

  return Response.json({
    checklist,
    summary: { total, checked, unchecked: total - checked },
  });
}
