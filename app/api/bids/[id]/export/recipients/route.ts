import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";
import { logOutreachEvent } from "@/lib/logging/outreachLogger";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  // SECURITY: Use explicit select to avoid leaking internal fields like isPreferred
  // This route exports to a file that may be sent to subs themselves.
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      id: true,
      projectName: true,
      selections: {
        select: {
          id: true,
          tradeId: true,
          subcontractorId: true,
          subcontractor: {
            select: {
              id: true,
              company: true,
              contacts: {
                where: { isPrimary: true },
                take: 1,
                select: { name: true, email: true, phone: true },
              },
              subTrades: {
                select: { tradeId: true, trade: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!bid) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Build rows
  type Row = {
    company: string;
    trade: string;
    contact: string;
    email: string;
    phone: string;
  };

  const rows: Row[] = bid.selections.map((sel) => {
    const sub = sel.subcontractor;
    const contact = sub.contacts[0] ?? null;
    const trade = sel.tradeId
      ? sub.subTrades.find((st) => st.tradeId === sel.tradeId)?.trade
      : sub.subTrades[0]?.trade;

    return {
      company: sub.company,
      trade: trade?.name ?? "",
      contact: contact?.name ?? "",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
    };
  });

  // Build workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Recipients");

  sheet.columns = [
    { header: "Company", key: "company", width: 30 },
    { header: "Trade", key: "trade", width: 20 },
    { header: "Contact", key: "contact", width: 25 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 18 },
  ];

  // Bold header row
  sheet.getRow(1).font = { bold: true };

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 5 },
  };

  // Freeze top row
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // Add data rows
  rows.forEach((row) => sheet.addRow(row));

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();

  const fileName = `${bid.projectName.replace(/[^a-z0-9]/gi, "_")}_recipients.xlsx`;

  // Record the export
  await prisma.exportBatch.create({
    data: {
      bidId,
      rowCount: rows.length,
      fileName,
    },
  });

  // Log one outreach event per exported selection — fire-and-forget
  for (const selection of bid.selections) {
    try {
      await logOutreachEvent({
        bidId: bid.id,
        subcontractorId: selection.subcontractorId,
        channel: "export",
        status: "exported",
        sentAt: new Date(),
      });
    } catch (err) {
      console.error("[outreachLogger] recipients export log failed:", err);
    }
  }

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
