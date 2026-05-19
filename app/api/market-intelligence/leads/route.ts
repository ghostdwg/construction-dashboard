import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const {
    title,
    leadType,
    location,
    jurisdiction,
    projectType,
    estimatedValue,
    source,
    sourceUrl,
    notes,
  } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const valueNum =
    estimatedValue === "" || estimatedValue == null
      ? null
      : Number(estimatedValue);
  if (valueNum !== null && !Number.isFinite(valueNum)) {
    return Response.json({ error: "estimatedValue must be numeric" }, { status: 400 });
  }

  const lead = await prisma.marketLead.create({
    data: {
      title: title.trim(),
      leadType: leadType || "MANUAL",
      source: source?.trim() || null,
      sourceUrl: sourceUrl?.trim() || null,
      location: location?.trim() || null,
      jurisdiction: jurisdiction?.trim() || null,
      projectType: projectType?.trim() || null,
      estimatedValue: valueNum,
      notes: notes?.trim() || null,
    },
  });

  return Response.json(lead, { status: 201 });
}
