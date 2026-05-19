import { prisma } from "@/lib/prisma";
import {
  fireAndForgetIngest,
  processNewMarketLead,
} from "@/lib/services/liveIngestion";

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

  // Phase MI-5 — live emergence ingestion. Route the freshly-created lead
  // through the resolver + project aggregator. Fire-and-forget: the lead
  // creation isn't gated on emergence processing, and any failure is
  // surfaced to logs (the MI-6 PR2 backfill picks up missed signals
  // idempotently).
  fireAndForgetIngest(processNewMarketLead(lead.id), `processNewMarketLead(${lead.id})`);

  return Response.json(lead, { status: 201 });
}
