import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search") ?? "";
  const tradeId = searchParams.get("tradeId");
  const status = searchParams.get("status");

  const subs = await prisma.subcontractor.findMany({
    where: {
      ...(search
        ? { company: { contains: search } }
        : {}),
      ...(status ? { status } : {}),
      ...(tradeId
        ? { subTrades: { some: { tradeId: parseInt(tradeId, 10) } } }
        : {}),
    },
    include: {
      subTrades: { include: { trade: true } },
      contacts: { where: { isPrimary: true }, take: 1 },
    },
    orderBy: { company: "asc" },
  });

  return Response.json(subs);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { company, office, status, notes, isUnion, isMWBE, isPreferred, tradeIds } = body;

  if (!company?.trim()) {
    return Response.json({ error: "company is required" }, { status: 400 });
  }

  const sub = await prisma.subcontractor.create({
    data: {
      company: company.trim(),
      office: office?.trim() || null,
      status: status || "active",
      notes: notes?.trim() || null,
      isUnion: !!isUnion,
      isMWBE: !!isMWBE,
      isPreferred: !!isPreferred,
      ...(tradeIds?.length
        ? {
            subTrades: {
              create: (tradeIds as number[]).map((tradeId) => ({ tradeId })),
            },
          }
        : {}),
    },
    include: {
      subTrades: { include: { trade: true } },
      contacts: true,
    },
  });

  return Response.json(sub, { status: 201 });
}
