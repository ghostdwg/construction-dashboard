import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { assembleBriefPrompt } from "./assembleBriefPrompt";
import { getMaxTokens } from "./aiTokenConfig";

// ----- JSON repair for truncated responses -----

function repairTruncatedJson(raw: string): string | null {
  let s = raw.trim();
  if (!s.startsWith("{")) return null;

  // Close any open string literal (odd number of unescaped quotes)
  const quotes = s.match(/(?<!\\)"/g);
  if (quotes && quotes.length % 2 !== 0) s += '"';

  // Walk through to figure out open brackets/braces
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && inString) { i++; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  if (stack.length === 0) return null; // already balanced — repair won't help

  // Remove trailing comma or colon that would make JSON invalid
  s = s.replace(/[,:\s]+$/, "");

  // Close all open containers in reverse order
  while (stack.length > 0) s += stack.pop();

  return s;
}

// ----- Types -----

type RawBrief = {
  whatIsThisJob?: string;
  howItGetsBuilt?: string;
  riskFlags?: unknown[];
  assumptionsToResolve?: unknown[];
  addendumSummary?: unknown[];
};

// ----- Stub generator -----

function generateStubBrief(): RawBrief {
  return {
    whatIsThisJob:
      "Interior fit-out of a 3-story, 45,000 SF medical office building shell in a downtown urban core. " +
      "Tenant improvement work includes full MEP rough-in, framing, drywall, ceilings, flooring, and specialty " +
      "medical finishes throughout. Owner is a regional healthcare system consolidating administrative and " +
      "clinical outpatient operations from two legacy facilities into this new building.",

    howItGetsBuilt:
      "Work proceeds floor-by-floor from the top down — 3rd floor first — to avoid conflicts with " +
      "elevator shaft work running concurrently on floors 1 and 2 during the first 8 weeks. Structural framing " +
      "and MEP rough-in lead the sequence with a 4-week float before board, tape, and above-ceiling inspections. " +
      "Base building MEP tie-ins require coordination with the landlord's contractor who remains active on site " +
      "for the first 8 weeks. Final finishes and commissioning are compressed into a 3-week window driven by " +
      "the owner's fixed occupancy permit deadline.",

    riskFlags: [
      {
        flag: "Compressed finish and commissioning window — 3 weeks is insufficient given medical equipment coordination requirements.",
        severity: "critical",
        foundIn: "Division 1 — Section 01 32 00 Construction Progress Schedule",
        potentialImpact:
          "Liquidated damages of $2,500/day apply after Day 180 per Owner General Conditions. " +
          "Medical equipment vendors require a minimum 6-week installation lead. Current schedule creates near-certain LD exposure.",
        confirmBefore: "Before issuing invite",
        recommendedAction:
          "Confirm with owner whether medical equipment is GC-coordinated or vendor-direct. " +
          "If GC-coordinated, request a minimum 3-week schedule extension before signing. " +
          "Otherwise, carry a $135k LD contingency (54 days × $2,500).",
      },
      {
        flag: "Base building MEP stub-out locations unverified against tenant improvement drawings.",
        severity: "moderate",
        foundIn: "Drawing sheets M-201 through M-204 — Mechanical Plans",
        potentialImpact:
          "Lease exhibit assigns relocation costs to contractor if stub-outs don't align with TI layout. " +
          "No unit pricing established. Potential $40,000–$80,000 in unpriced rework.",
        confirmBefore: "Before bid day",
        recommendedAction:
          "Issue RFI to base building architect requesting as-built MEP stub-out locations before bid. " +
          "Carry a $15,000 MEP coordination allowance pending confirmation.",
      },
      {
        flag: "Acoustic partition spec requires field-verified STC assemblies — not standard drywall throughout.",
        severity: "low",
        foundIn: "Specification Section 09 21 16 — Gypsum Board Assemblies",
        potentialImpact:
          "STC-rated assemblies require 5/8\" Type X on both sides plus acoustic batt — approximately " +
          "15% more labor than standard partitions. Linear footage of STC partitions not broken out separately.",
        confirmBefore: "Before issuing estimate",
        recommendedAction:
          "Take off linear footage of STC-rated partitions separately from drawings and apply a blended rate. " +
          "Do not carry a single partition rate for the entire project.",
      },
    ],

    assumptionsToResolve: [
      {
        assumption:
          "Owner furnishes and installs all medical equipment. GC scope is blocking, rough-in, and utility stub-outs only — no GC coordination of equipment vendors.",
        sourceRef: "Division 1 — Section 01 10 00 Summary of Work",
        urgency: "before_invite",
      },
      {
        assumption:
          "Base building freight elevator is available for material hoisting during off-hours (nights and Saturdays). No dedicated freight elevator is shown in base building drawings.",
        sourceRef: "Drawing Sheet A-001 — Site Logistics Plan",
        urgency: "before_invite",
      },
      {
        assumption:
          "Owner will provide a design-assist MEP engineer for above-ceiling coordination. GC MEP subs are responsible for prefab coordination drawings only — not design.",
        sourceRef: "Division 1 — Section 01 31 13 Project Coordination",
        urgency: "before_bid_day",
      },
      {
        assumption:
          "All hazardous materials surveys are complete. No abatement scope carried. If ACM or LBP is encountered during demolition, owner directs and pays separately outside the GMP.",
        sourceRef: "Division 0 — Owner General Conditions (Exhibit C)",
        urgency: "before_bid_day",
      },
      {
        assumption:
          "Temporary power and lighting provided by landlord at no cost during construction. GC responsible only for temporary distribution from landlord's panel — no temporary generator required.",
        sourceRef: "Not explicitly stated in documents — requires written confirmation from landlord",
        urgency: "post_award",
      },
    ],

    addendumSummary: [],
  };
}

// ----- Stub upsert helper -----

async function saveStubBrief(bidId: number, triggeredBy: string): Promise<void> {
  // Spinner: set generating immediately
  await prisma.bidIntelligenceBrief.upsert({
    where: { bidId },
    create: { bidId, status: "generating", triggeredBy },
    update: { status: "generating", isStale: false, triggeredBy },
  });

  // Artificial delay so the spinner state is visible in the UI
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const brief = generateStubBrief();

  const sourceContext = JSON.stringify({
    division1Detected: false,
    specSectionCount: 0,
    drawingDisciplines: [],
    addendumCount: 0,
    generatedFrom: "Stub mode — no documents required",
  });

  await prisma.bidIntelligenceBrief.upsert({
    where: { bidId },
    create: {
      bidId,
      status: "ready",
      isStale: false,
      triggeredBy,
      generatedAt: new Date(),
      whatIsThisJob: brief.whatIsThisJob ?? null,
      howItGetsBuilt: brief.howItGetsBuilt ?? null,
      riskFlags: Array.isArray(brief.riskFlags) ? JSON.stringify(brief.riskFlags) : null,
      assumptionsToResolve: Array.isArray(brief.assumptionsToResolve)
        ? JSON.stringify(brief.assumptionsToResolve)
        : null,
      addendumSummary: Array.isArray(brief.addendumSummary)
        ? JSON.stringify(brief.addendumSummary)
        : null,
      addendumCount: 0,
      sourceContext,
    },
    update: {
      status: "ready",
      isStale: false,
      triggeredBy,
      generatedAt: new Date(),
      whatIsThisJob: brief.whatIsThisJob ?? null,
      howItGetsBuilt: brief.howItGetsBuilt ?? null,
      riskFlags: Array.isArray(brief.riskFlags) ? JSON.stringify(brief.riskFlags) : null,
      assumptionsToResolve: Array.isArray(brief.assumptionsToResolve)
        ? JSON.stringify(brief.assumptionsToResolve)
        : null,
      addendumSummary: Array.isArray(brief.addendumSummary)
        ? JSON.stringify(brief.addendumSummary)
        : null,
      addendumCount: 0,
      sourceContext,
    },
  });
}

// ----- Main function -----

export async function generateBidIntelligenceBrief(
  bidId: number,
  triggeredBy = "manual"
): Promise<{ status: string; sourceContext: Awaited<ReturnType<typeof assembleBriefPrompt>>["sourceContext"] | null }> {

  // ----- STUB MODE -----
  if (process.env.BRIEF_STUB_MODE === "true") {
    await saveStubBrief(bidId, triggeredBy);
    return {
      status: "ready",
      sourceContext: null,
    };
  }

  // ----- LIVE MODE -----

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

  let brief: RawBrief;
  let sourceContext: Awaited<ReturnType<typeof assembleBriefPrompt>>["sourceContext"];

  try {
    const prompt = await assembleBriefPrompt(bidId);
    sourceContext = prompt.sourceContext;

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: await getMaxTokens("brief"),
      system: prompt.systemPrompt,
      messages: [{ role: "user", content: prompt.userPrompt }],
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

    try {
      brief = JSON.parse(raw);
      if (typeof brief !== "object" || Array.isArray(brief)) {
        throw new Error("Response is not a JSON object");
      }
    } catch {
      // Attempt to repair truncated JSON before giving up
      const repaired = repairTruncatedJson(raw);
      if (repaired) {
        brief = JSON.parse(repaired);
        if (typeof brief !== "object" || Array.isArray(brief)) {
          throw new Error("Repaired response is not a JSON object");
        }
      } else {
        throw new Error(`Failed to parse AI response as JSON: ${raw.slice(0, 300)}`);
      }
    }
  } catch (err) {
    // Reset status so the UI doesn't poll forever
    await prisma.bidIntelligenceBrief.update({
      where: { bidId },
      data: { status: "error" },
    }).catch(() => {});
    throw err;
  }

  const sourceContextStr = JSON.stringify({
    ...sourceContext,
    generatedFrom: "Live generation",
  });

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
      sourceContext: sourceContextStr,
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
      sourceContext: sourceContextStr,
    },
  });

  return { status: "ready", sourceContext };
}
