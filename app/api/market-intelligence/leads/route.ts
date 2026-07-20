import { prisma } from "@/lib/prisma";
import { canPromote } from "@/lib/services/pursuitPromotion";
import { resolvePromotionActor } from "@/lib/services/pursuitPromotion/actor";
import {
  fireAndForgetIngest,
  processNewMarketLead,
} from "@/lib/services/liveIngestion";

export async function POST(request: Request) {
  const actor = await resolvePromotionActor();
  if (!actor) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canPromote(actor)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
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

  const textFields = [
    leadType,
    location,
    jurisdiction,
    projectType,
    source,
    sourceUrl,
    notes,
  ];
  if (textFields.some((value) => value != null && typeof value !== "string")) {
    return Response.json({ error: "Text fields must be strings" }, { status: 400 });
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
      leadType: typeof leadType === "string" && leadType ? leadType : "MANUAL",
      source: typeof source === "string" ? source.trim() || null : null,
      sourceUrl: typeof sourceUrl === "string" ? sourceUrl.trim() || null : null,
      location: typeof location === "string" ? location.trim() || null : null,
      jurisdiction: typeof jurisdiction === "string" ? jurisdiction.trim() || null : null,
      projectType: typeof projectType === "string" ? projectType.trim() || null : null,
      estimatedValue: valueNum,
      notes: typeof notes === "string" ? notes.trim() || null : null,
    },
  });

  // Phase MI-5 — live emergence ingestion. Route the freshly-created lead
  // through the resolver + project aggregator. Fire-and-forget: the lead
  // creation isn't gated on emergence processing, and any failure is
  // surfaced to logs (the MI-6 PR2 backfill picks up missed signals
  // idempotently).
  fireAndForgetIngest(
    processNewMarketLead(lead.id, {
      actor: { userId: actor.id, email: actor.email ?? null },
    }),
    `processNewMarketLead(${lead.id})`
  );

  return Response.json(lead, { status: 201 });
}
