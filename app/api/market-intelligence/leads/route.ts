import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["PERMIT","MEETING_MINUTE","PLAN_ROOM","LAND_ACQUISITION","BROKER","RELATIONSHIP","MANUAL"];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, leadType, location, jurisdiction, projectType, estimatedValue, source, sourceUrl, notes } = body;

  if (!title?.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const lead = await prisma.marketLead.create({
    data: {
      title:          title.trim(),
      leadType:       VALID_TYPES.includes(leadType) ? leadType : "MANUAL",
      location:       location?.trim() || null,
      jurisdiction:   jurisdiction?.trim() || null,
      projectType:    projectType?.trim() || null,
      estimatedValue: estimatedValue ? parseFloat(estimatedValue) : null,
      source:         source?.trim() || null,
      sourceUrl:      sourceUrl?.trim() || null,
      notes:          notes?.trim() || null,
      status:         "NEW",
    },
  });

  return NextResponse.json(lead, { status: 201 });
}
