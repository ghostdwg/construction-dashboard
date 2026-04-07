import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { assembleBriefPrompt } from "./assembleBriefPrompt";

// ----- Types -----

type RawBrief = {
  whatIsThisJob?: string;
  howItGetsBuilt?: string;
  riskFlags?: unknown[];
  assumptionsToResolve?: unknown[];
  addendumSummary?: unknown[];
};

// ----- Main function -----

export async function generateBidIntelligenceBrief(
  bidId: number,
  triggeredBy = "manual"
): Promise<{ status: string; sourceContext: Awaited<ReturnType<typeof assembleBriefPrompt>>["sourceContext"] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — AI generation unavailable");
  }

  // Upsert brief in "generating" state immediately so UI shows spinner
  await prisma.bidIntelligenceBrief.upsert({
    where: { bidId },
    create: { bidId, status: "generating", triggeredBy },
    update: { status: "generating", isStale: false, triggeredBy },
  });

  const { systemPrompt, userPrompt, sourceContext } = await assembleBriefPrompt(bidId);

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content");
  }

  // Strip markdown fences if present
  const raw = textBlock.text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  let brief: RawBrief;
  try {
    brief = JSON.parse(raw);
    if (typeof brief !== "object" || Array.isArray(brief)) {
      throw new Error("Response is not a JSON object");
    }
  } catch {
    throw new Error(`Failed to parse AI response as JSON: ${raw.slice(0, 300)}`);
  }

  await prisma.bidIntelligenceBrief.upsert({
    where: { bidId },
    create: {
      bidId,
      status: "ready",
      isStale: false,
      triggeredBy,
      generatedAt: new Date(),
      whatIsThisJob: typeof brief.whatIsThisJob === "string" ? brief.whatIsThisJob : null,
      howItGetsBuilt: typeof brief.howItGetsBuilt === "string" ? brief.howItGetsBuilt : null,
      riskFlags: Array.isArray(brief.riskFlags) ? JSON.stringify(brief.riskFlags) : null,
      assumptionsToResolve: Array.isArray(brief.assumptionsToResolve)
        ? JSON.stringify(brief.assumptionsToResolve)
        : null,
      addendumSummary: Array.isArray(brief.addendumSummary)
        ? JSON.stringify(brief.addendumSummary)
        : null,
      addendumCount: sourceContext.addendumCount,
      sourceContext: JSON.stringify(sourceContext),
    },
    update: {
      status: "ready",
      isStale: false,
      triggeredBy,
      generatedAt: new Date(),
      whatIsThisJob: typeof brief.whatIsThisJob === "string" ? brief.whatIsThisJob : null,
      howItGetsBuilt: typeof brief.howItGetsBuilt === "string" ? brief.howItGetsBuilt : null,
      riskFlags: Array.isArray(brief.riskFlags) ? JSON.stringify(brief.riskFlags) : null,
      assumptionsToResolve: Array.isArray(brief.assumptionsToResolve)
        ? JSON.stringify(brief.assumptionsToResolve)
        : null,
      addendumSummary: Array.isArray(brief.addendumSummary)
        ? JSON.stringify(brief.addendumSummary)
        : null,
      addendumCount: sourceContext.addendumCount,
      sourceContext: JSON.stringify(sourceContext),
    },
  });

  return { status: "ready", sourceContext };
}
