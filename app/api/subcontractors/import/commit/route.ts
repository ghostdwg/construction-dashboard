import { prisma } from "@/lib/prisma";

// POST /api/subcontractors/import/commit
// Body: { rows: PreviewRow[] }
//   PreviewRow includes: company, office, ..., trades[], action, isPreferred, conflictWith
// Persists in a single transaction. Returns counts.

type CommitRow = {
  company: string;
  office?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  isUnion?: boolean;
  isMWBE?: boolean;
  isPreferred?: boolean;
  procoreVendorId?: string | null;
  resolvedTrades?: { tradeId: number | null }[];
  action: "create" | "update" | "skip";
  conflictWith?: { id: number } | null;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { rows?: CommitRow[] } | null;
  if (!body || !Array.isArray(body.rows)) {
    return Response.json({ error: "rows array is required" }, { status: 400 });
  }

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const errors: { company: string; error: string }[] = [];

  for (const row of body.rows) {
    if (row.action === "skip") {
      skippedCount++;
      continue;
    }

    const tradeIds = (row.resolvedTrades ?? [])
      .map((t) => t.tradeId)
      .filter((id): id is number => id != null);

    const data = {
      company: row.company.trim(),
      office: row.office?.trim() || null,
      isUnion: !!row.isUnion,
      isMWBE: !!row.isMWBE,
      isPreferred: !!row.isPreferred,
      procoreVendorId: row.procoreVendorId?.trim() || null,
    };

    try {
      if (row.action === "update" && row.conflictWith?.id) {
        // Update existing — replace trade joins to reflect new list
        await prisma.$transaction(async (tx) => {
          await tx.subcontractor.update({
            where: { id: row.conflictWith!.id },
            data,
          });
          if (tradeIds.length > 0) {
            await tx.subcontractorTrade.deleteMany({
              where: { subcontractorId: row.conflictWith!.id },
            });
            await tx.subcontractorTrade.createMany({
              data: tradeIds.map((tradeId) => ({
                subcontractorId: row.conflictWith!.id,
                tradeId,
              })),
            });
          }
          // Update or create primary contact if email provided
          if (row.contactEmail || row.contactPhone || row.contactName) {
            const existingPrimary = await tx.contact.findFirst({
              where: { subcontractorId: row.conflictWith!.id, isPrimary: true },
            });
            const contactData = {
              name: row.contactName?.trim() || row.company.trim(),
              email: row.contactEmail?.trim() || null,
              phone: row.contactPhone?.trim() || row.phone?.trim() || null,
              isPrimary: true,
            };
            if (existingPrimary) {
              await tx.contact.update({ where: { id: existingPrimary.id }, data: contactData });
            } else {
              await tx.contact.create({ data: { ...contactData, subcontractorId: row.conflictWith!.id } });
            }
          }
        });
        updatedCount++;
      } else {
        // Create new
        await prisma.subcontractor.create({
          data: {
            ...data,
            ...(tradeIds.length > 0 ? {
              subTrades: { create: tradeIds.map((tradeId) => ({ tradeId })) },
            } : {}),
            ...((row.contactEmail || row.contactPhone || row.contactName) ? {
              contacts: {
                create: {
                  name: row.contactName?.trim() || row.company.trim(),
                  email: row.contactEmail?.trim() || null,
                  phone: row.contactPhone?.trim() || row.phone?.trim() || null,
                  isPrimary: true,
                },
              },
            } : {}),
          },
        });
        createdCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ company: row.company, error: message });
    }
  }

  return Response.json({
    createdCount,
    updatedCount,
    skippedCount,
    errorCount: errors.length,
    errors,
  });
}
