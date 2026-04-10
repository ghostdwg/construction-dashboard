import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { assembleAddendumDeltaPrompt } from "@/lib/services/ai/assembleAddendumDeltaPrompt";
import { getMaxTokens } from "@/lib/services/ai/aiTokenConfig";

// ----- Types -----

type ScopeChange = {
  type: string;
  description: string;
  location: string;
  costImpact: string;
  scheduleImpact: string;
  actionRequired: string;
};

type Clarification = {
  description: string;
  location: string;
  actionRequired: string;
};

type NewRisk = {
  severity: string;
  description: string;
  sourceRef: string;
  recommendedAction: string;
};

export type AddendumDelta = {
  addendumNumber: number;
  dateIssued: string | null;
  summary: string;
  changesIdentified: number;
  scopeChanges: ScopeChange[];
  clarifications: Clarification[];
  newRisks: NewRisk[];
  resolvedItems: string[];
  netCostDirection: "INCREASE" | "DECREASE" | "NEUTRAL";
  netScheduleDirection: "INCREASE" | "DECREASE" | "NEUTRAL";
  actionsRequired: string[];
};

// ----- Stub generator -----

function generateStubDelta(addendumNumber: number): AddendumDelta {
  return {
    addendumNumber,
    dateIssued: "2026-04-07",
    summary:
      "Addendum revises flooring spec in Division 9, adds a long-lead signage package, and confirms base bid scope for temporary utilities.",
    changesIdentified: 4,
    scopeChanges: [
      {
        type: "MODIFICATION",
        description:
          "Division 9 — Flooring spec updated from LVT to broadloom carpet in open office areas on floors 2 and 3. New spec references Shaw Contract Group product 54880, 32 oz face weight.",
        location: "Spec Section 09 65 00 — Resilient Flooring / 09 68 00 — Carpeting",
        costImpact: "INCREASE",
        scheduleImpact: "NONE",
        actionRequired:
          "Request revised quotes from flooring subs with updated carpet spec. Confirm lead time on Shaw Contract 54880 — verify 6-week lead before locking schedule.",
      },
      {
        type: "ADDITION",
        description:
          "New exterior signage package added — building ID monument sign and suite directory at main entry. Owner-furnished, GC-installed.",
        location: "Spec Section 10 14 00 — Signage",
        costImpact: "INCREASE",
        scheduleImpact: "INCREASE",
        actionRequired:
          "Confirm GC installation scope with owner. Add signage blocking to framing scope. Request sign package shop drawings timeline from owner.",
      },
    ],
    clarifications: [
      {
        description:
          "Confirmed base bid includes temporary utilities through substantial completion. No separate temporary power allowance required.",
        location: "RFI #3 response — incorporated into Addendum",
        actionRequired: "No action — remove any temporary power allowance from estimate.",
      },
      {
        description:
          "Acoustic partition STC requirements confirmed at STC-47 throughout — no exceptions for storage rooms.",
        location: "Spec Section 09 21 16 — Gypsum Board Assemblies",
        actionRequired:
          "Verify framing subs have priced full STC-47 assembly throughout. Do not allow standard partition pricing for any room.",
      },
    ],
    newRisks: [
      {
        severity: "MODERATE",
        description:
          "Shaw Contract 54880 carpet has a 10-week lead time per manufacturer — current schedule only allows 6 weeks from award to flooring install.",
        sourceRef: "Spec Section 09 68 00",
        recommendedAction:
          "Negotiate early release of flooring purchase order with owner or identify an in-stock alternative that meets the spec intent.",
      },
    ],
    resolvedItems: [
      "Confirmed GC responsibility for temporary utilities — no allowance required (RFI #3)",
      "Acoustic partition STC requirement confirmed throughout — no exceptions",
    ],
    netCostDirection: "INCREASE",
    netScheduleDirection: "INCREASE",
    actionsRequired: [
      "Re-quote flooring subs with updated carpet spec (Spec Section 09 68 00 — Shaw Contract 54880)",
      "Verify lead time on new signage package with owner — confirm GC install scope",
      "Remove temporary power allowance from estimate per RFI #3 resolution",
      "Confirm all framing subs have priced STC-47 assembly throughout — no exceptions",
    ],
  };
}

// ----- POST /api/bids/[id]/addendums/[addendumId]/delta -----

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  const { id, addendumId } = await params;
  const bidId = parseInt(id, 10);
  const aId = parseInt(addendumId, 10);
  if (isNaN(bidId) || isNaN(aId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  // 1 — Load addendum, verify it belongs to this bid
  const addendum = await prisma.addendumUpload.findUnique({
    where: { id: aId },
    select: {
      id: true,
      bidId: true,
      addendumNumber: true,
      extractedText: true,
      status: true,
    },
  });
  if (!addendum || addendum.bidId !== bidId) {
    return Response.json({ error: "Addendum not found" }, { status: 404 });
  }
  if (addendum.status !== "ready") {
    return Response.json(
      { error: "Addendum is not ready — wait for extraction to complete" },
      { status: 422 }
    );
  }

  // 2 — Load existing brief
  const brief = await prisma.bidIntelligenceBrief.findUnique({
    where: { bidId },
    select: {
      id: true,
      status: true,
      whatIsThisJob: true,
      riskFlags: true,
      addendumDeltas: true,
    },
  });

  // 3 — Brief must exist and be ready
  if (!brief || brief.status !== "ready") {
    return Response.json(
      {
        error:
          "Generate the project intelligence brief before processing an addendum delta",
      },
      { status: 422 }
    );
  }

  // 4 — Addendum text (already extracted during upload)
  const addendumText = addendum.extractedText ?? "";

  // 5 — Load previous deltas from other addendum uploads on this bid
  const previousAddendums = await prisma.addendumUpload.findMany({
    where: {
      bidId,
      id: { not: aId },
      summary: { not: null },
    },
    orderBy: { addendumNumber: "asc" },
    select: { addendumNumber: true, summary: true },
  });

  const previousDeltas = previousAddendums
    .filter((a): a is typeof a & { summary: string } => a.summary !== null)
    .map((a) => ({ addendumNumber: a.addendumNumber, summary: a.summary }));

  // 6 — STUB MODE
  if (process.env.ADDENDUM_STUB_MODE === "true") {
    await new Promise((resolve) => setTimeout(resolve, 800));

    const delta = generateStubDelta(addendum.addendumNumber);

    // Store delta on addendum record
    await prisma.addendumUpload.update({
      where: { id: aId },
      data: {
        deltaJson: JSON.stringify(delta),
        deltaGeneratedAt: new Date(),
        summary: delta.summary,
      },
    });

    // Append to brief.addendumDeltas
    const existingDeltas = (() => {
      try {
        return brief.addendumDeltas ? JSON.parse(brief.addendumDeltas) : [];
      } catch {
        return [];
      }
    })() as { addendumNumber: number; summary: string }[];

    const updatedDeltas = [
      ...existingDeltas.filter((d) => d.addendumNumber !== delta.addendumNumber),
      { addendumNumber: delta.addendumNumber, summary: delta.summary },
    ];

    await prisma.bidIntelligenceBrief.update({
      where: { bidId },
      data: {
        addendumDeltas: JSON.stringify(updatedDeltas),
        isStale: false,
      },
    });

    return Response.json({ delta, addendumId: aId });
  }

  // 7 — LIVE MODE: assemble prompt
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { projectType: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const { systemPrompt, userPrompt } = assembleAddendumDeltaPrompt({
    bid: { projectType: String(bid.projectType) },
    existingBrief: {
      whatIsThisJob: brief.whatIsThisJob,
      riskFlags: brief.riskFlags,
    },
    addendumText,
    previousDeltas,
  });

  // 8 — Call Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set — AI generation unavailable" },
      { status: 503 }
    );
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: await getMaxTokens("addendum-delta"),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return Response.json({ error: "AI returned no text content" }, { status: 500 });
  }

  // 9 — Parse JSON response
  const raw = textBlock.text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  let delta: AddendumDelta;
  try {
    delta = JSON.parse(raw) as AddendumDelta;
    if (typeof delta !== "object" || Array.isArray(delta)) {
      throw new Error("Response is not a JSON object");
    }
  } catch {
    return Response.json(
      { error: `Failed to parse AI response as JSON: ${raw.slice(0, 200)}` },
      { status: 500 }
    );
  }

  // 10 — Store delta on addendum record
  await prisma.addendumUpload.update({
    where: { id: aId },
    data: {
      deltaJson: JSON.stringify(delta),
      deltaGeneratedAt: new Date(),
      summary: delta.summary ?? null,
    },
  });

  // 11 — Append to brief.addendumDeltas
  const existingDeltas = (() => {
    try {
      return brief.addendumDeltas ? JSON.parse(brief.addendumDeltas) : [];
    } catch {
      return [];
    }
  })() as { addendumNumber: number; summary: string }[];

  const updatedDeltas = [
    ...existingDeltas.filter((d) => d.addendumNumber !== delta.addendumNumber),
    { addendumNumber: delta.addendumNumber, summary: delta.summary },
  ];

  // 12 — Clear stale flag
  await prisma.bidIntelligenceBrief.update({
    where: { bidId },
    data: {
      addendumDeltas: JSON.stringify(updatedDeltas),
      isStale: false,
    },
  });

  // 13 — Return
  return Response.json({ delta, addendumId: aId });
}
