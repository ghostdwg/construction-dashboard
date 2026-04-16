// GET /api/bids/[id]/procore-export/vendors
//
// Exports subcontractors associated with this bid as a CSV in Procore's
// Company Directory import format. Includes all subs that were invited
// via RFQ or awarded a contract on this project.
//
// Procore Company Directory import columns (Admin → Directory → Companies):
//   Name, Trade, Phone, Fax, Email, Address, City, State, Zip, Country,
//   License #, Business Type

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

  // Fetch all subs reachable from this bid in one query:
  // invited (BidInviteSelection) OR awarded (BuyoutItem.subcontractorId set).
  const subs = await prisma.subcontractor.findMany({
    where: {
      OR: [
        { selections: { some: { bidId } } },
        { buyoutItems: { some: { bidId } } },
      ],
    },
    select: {
      id: true,
      company: true,
      contacts: {
        where: { isPrimary: true },
        select: { phone: true, email: true },
        take: 1,
      },
      // Pull trade name via the buyout item on this bid (most specific source)
      buyoutItems: {
        where: { bidId },
        select: {
          bidTrade: { select: { trade: { select: { name: true } } } },
        },
        take: 1,
      },
      // Fallback: first trade from SubcontractorTrade
      subTrades: {
        select: { trade: { select: { name: true } } },
        take: 1,
      },
    },
  });

  if (subs.length === 0) {
    return Response.json({ error: "No subcontractors found for this bid" }, { status: 404 });
  }

  const header = toCsvRow([
    "Name", "Trade", "Phone", "Fax", "Email",
    "Address", "City", "State", "Zip", "Country",
    "License #", "Business Type",
  ]);

  const rows = [header];
  for (const sub of subs) {
    const contact = sub.contacts[0];
    // Prefer trade from the awarded buyout item; fall back to SubcontractorTrade
    const tradeName =
      sub.buyoutItems[0]?.bidTrade?.trade?.name ??
      sub.subTrades[0]?.trade?.name ??
      null;

    rows.push(
      toCsvRow([
        sub.company,
        tradeName,
        contact?.phone ?? null,
        null,          // Fax
        contact?.email ?? null,
        null,          // Address
        null,          // City
        null,          // State
        null,          // Zip
        null,          // Country
        null,          // License #
        "Subcontractor",
      ])
    );
  }

  const safeName = (bid.projectName ?? "project")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();

  return new Response(rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="procore-vendors-${safeName}.csv"`,
    },
  });
}
