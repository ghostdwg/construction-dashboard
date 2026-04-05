import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export async function POST(
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
    include: {
      selections: {
        include: {
          subcontractor: {
            include: {
              contacts: { where: { isPrimary: true }, take: 1 },
              subTrades: { include: { trade: true } },
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

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
