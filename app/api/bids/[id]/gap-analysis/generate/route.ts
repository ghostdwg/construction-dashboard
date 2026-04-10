import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { assembleGapPrompt } from "@/lib/services/ai/assembleGapPrompt";
import { getMaxTokens } from "@/lib/services/ai/aiTokenConfig";

// ----- Types -----

type RawGapFinding = {
  severity?: string;
  title?: string;
  description?: string;
  sourceRef?: string;
  suggestedQuestion?: string;
  foundIn?: string;
};

// ----- Stub generator -----

function generateStubGapFindings(tradeName: string): RawGapFinding[] {
  const trade = tradeName.toLowerCase();

  // Generic realistic findings mapped loosely to the trade name
  const isMep =
    trade.includes("mechanical") ||
    trade.includes("electrical") ||
    trade.includes("plumbing") ||
    trade.includes("hvac") ||
    trade.includes("fire protection");

  const isArchitectural =
    trade.includes("drywall") ||
    trade.includes("framing") ||
    trade.includes("ceiling") ||
    trade.includes("flooring") ||
    trade.includes("painting") ||
    trade.includes("millwork");

  if (isMep) {
    return [
      {
        severity: "CRITICAL",
        title: "Above-ceiling coordination drawings not included in scope",
        description:
          `Specification Section 01 31 13 (Project Coordination) requires GC-directed BIM coordination ` +
          `for all above-ceiling MEP systems prior to rough-in. No submission for ${tradeName} references ` +
          `coordination drawing deliverables or clash detection participation.`,
        sourceRef: "Spec Section 01 31 13 — Project Coordination",
        suggestedQuestion:
          `Does your ${tradeName} scope include participation in above-ceiling MEP coordination ` +
          `and BIM clash detection as required by Section 01 31 13? Confirm deliverable and schedule.`,
        foundIn: "SPEC_BOOK",
      },
      {
        severity: "MODERATE",
        title: "Testing and balancing allowance not identified",
        description:
          `Division 1 identifies testing and balancing (TAB) as a GC-furnished/sub-coordinated ` +
          `scope item. No ${tradeName} submission references TAB coordination or access requirements ` +
          `during the commissioning window.`,
        sourceRef: "Spec Section 01 91 13 — General Commissioning Requirements",
        suggestedQuestion:
          `Confirm your scope includes providing access, start-up coordination, and punch-list ` +
          `response during testing and balancing per Section 01 91 13.`,
        foundIn: "SPEC_BOOK",
      },
      {
        severity: "LOW",
        title: "Temporary utility connections during construction not addressed",
        description:
          `Section 01 50 00 (Temporary Facilities) assigns temporary mechanical and electrical ` +
          `distribution to the responsible ${tradeName} sub. Submissions are silent on whether ` +
          `temporary utility distribution from landlord stub-outs is included or excluded.`,
        sourceRef: "Spec Section 01 50 00 — Temporary Facilities and Controls",
        suggestedQuestion:
          `Is temporary utility distribution from base building stub-outs included in your ` +
          `${tradeName} scope? Confirm included/excluded with unit pricing if excluded.`,
        foundIn: "SPEC_BOOK",
      },
    ];
  }

  if (isArchitectural) {
    return [
      {
        severity: "CRITICAL",
        title: "STC-rated partition assemblies not separated from standard partitions",
        description:
          `Specification Section 09 21 16 (Gypsum Board Assemblies) requires STC-rated assemblies ` +
          `at all exam rooms, conference rooms, and executive offices. ${tradeName} submissions use ` +
          `a single blended partition rate with no differentiation for STC assemblies, which require ` +
          `5/8" Type X both sides plus acoustic batt and staggered stud framing.`,
        sourceRef: "Spec Section 09 21 16 — Gypsum Board Assemblies",
        suggestedQuestion:
          `Confirm your scope and unit pricing separately covers STC-rated partition assemblies ` +
          `per Section 09 21 16. Provide separate per-LF rate for STC vs. standard partitions.`,
        foundIn: "SPEC_BOOK",
      },
      {
        severity: "MODERATE",
        title: "Blocking and backing for owner-furnished equipment not addressed",
        description:
          `Drawing sheets A-501 through A-504 (Enlarged Plans — Equipment) indicate blocking and ` +
          `backing requirements for wall-mounted monitors, casework, and specialty equipment ` +
          `throughout. No ${tradeName} submission references this scope.`,
        sourceRef: "Drawing Sheets A-501 through A-504",
        suggestedQuestion:
          `Does your ${tradeName} scope include blocking and backing for wall-mounted equipment ` +
          `per Drawing Sheets A-501 through A-504? List any exclusions with reasons.`,
        foundIn: "BOTH",
      },
      {
        severity: "LOW",
        title: "Touch-up paint at punch list not explicitly included",
        description:
          `Section 09 91 23 (Interior Painting) requires final punch-list touch-up paint to be ` +
          `completed after all other trades. This scope item is typically disputed between ` +
          `${tradeName} and general labor — confirm assignment.`,
        sourceRef: "Spec Section 09 91 23 — Interior Painting",
        suggestedQuestion:
          `Confirm your scope includes final punch-list touch-up paint per Section 09 91 23 ` +
          `after all other trades complete their work.`,
        foundIn: "SPEC_BOOK",
      },
    ];
  }

  // Generic fallback for any other trade
  return [
    {
      severity: "CRITICAL",
      title: "Division 1 coordination requirements not acknowledged",
      description:
        `Section 01 31 00 (Project Management and Coordination) requires all trade contractors ` +
        `to submit a coordination schedule and attend weekly coordination meetings. ` +
        `No ${tradeName} submission references these Division 1 requirements.`,
      sourceRef: "Spec Section 01 31 00 — Project Management and Coordination",
      suggestedQuestion:
        `Confirm your ${tradeName} scope includes participation in weekly coordination meetings ` +
        `and coordination schedule submittals per Section 01 31 00.`,
      foundIn: "SPEC_BOOK",
    },
    {
      severity: "MODERATE",
      title: "Submittal schedule and lead time not provided",
      description:
        `Section 01 33 00 (Submittal Procedures) requires each trade to submit a submittal log ` +
        `with anticipated lead times within 10 days of award. ${tradeName} scope descriptions do ` +
        `not reference any submittals or material lead time risks for long-lead items.`,
      sourceRef: "Spec Section 01 33 00 — Submittal Procedures",
      suggestedQuestion:
        `What submittals are required for your ${tradeName} scope and what are the lead times ` +
        `for any long-lead materials? Provide submittal log per Section 01 33 00.`,
      foundIn: "SPEC_BOOK",
    },
    {
      severity: "LOW",
      title: "Warranty period and documentation requirements not addressed",
      description:
        `Section 01 78 00 (Closeout Submittals) requires one-year warranty letters, O&M manuals, ` +
        `and as-built documentation for all trade work. ${tradeName} submissions are silent on ` +
        `closeout deliverable requirements.`,
      sourceRef: "Spec Section 01 78 00 — Closeout Submittals",
      suggestedQuestion:
        `Confirm your ${tradeName} scope includes all closeout deliverables required by ` +
        `Section 01 78 00 — warranty letters, O&M manuals, and as-built documentation.`,
      foundIn: "SPEC_BOOK",
    },
  ];
}

// ----- Normalize severity/sourceDocument values -----

const VALID_SEVERITY = new Set(["critical", "moderate", "low"]);
const SEVERITY_MAP: Record<string, string> = {
  CRITICAL: "critical",
  MODERATE: "moderate",
  LOW: "low",
};

const VALID_SOURCE = new Set(["SPEC_BOOK", "DRAWINGS", "BOTH", "BRIEF"]);

function normalizeSeverity(raw: string | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (SEVERITY_MAP[upper]) return SEVERITY_MAP[upper];
  if (VALID_SEVERITY.has(raw.toLowerCase())) return raw.toLowerCase();
  return null;
}

function normalizeFoundIn(raw: string | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return VALID_SOURCE.has(upper) ? upper : null;
}

// ----- Save findings for a trade -----

async function saveFindingsForTrade(
  bidId: number,
  tradeId: number,
  tradeName: string,
  rawFindings: RawGapFinding[]
): Promise<number> {
  // Delete existing findings for this bid+trade combo
  await prisma.aiGapFinding.deleteMany({
    where: { bidId, tradeName },
  });

  const toCreate = rawFindings.filter(
    (f) => f.title && f.title.trim().length > 0
  );

  if (toCreate.length === 0) return 0;

  const created = await prisma.$transaction(
    toCreate.map((f) =>
      prisma.aiGapFinding.create({
        data: {
          bidId,
          tradeName,
          title: f.title?.trim() ?? null,
          findingText: f.description?.trim() ?? f.title?.trim() ?? "",
          sourceRef: f.sourceRef?.trim() ?? null,
          severity: normalizeSeverity(f.severity),
          sourceDocument: normalizeFoundIn(f.foundIn),
          reviewNotes: f.suggestedQuestion?.trim() ?? null,
          status: "pending_review",
        },
      })
    )
  );

  return created.length;
}

// ----- Main export (callable from other routes) -----

export async function runGapAnalysis(
  bidId: number,
  tradeIdFilter?: number
): Promise<{ totalFindings: number; tradesAnalyzed: number }> {
  const bidTrades = await prisma.bidTrade.findMany({
    where: {
      bidId,
      ...(tradeIdFilter ? { tradeId: tradeIdFilter } : {}),
    },
    include: { trade: { select: { id: true, name: true } } },
  });

  if (bidTrades.length === 0) return { totalFindings: 0, tradesAnalyzed: 0 };

  let totalFindings = 0;
  let tradesAnalyzed = 0;

  // ----- STUB MODE -----
  if (process.env.GAP_STUB_MODE === "true") {
    for (const bt of bidTrades) {
      const rawFindings = generateStubGapFindings(bt.trade.name);
      const count = await saveFindingsForTrade(
        bidId,
        bt.trade.id,
        bt.trade.name,
        rawFindings
      );
      totalFindings += count;
      tradesAnalyzed++;
    }
    return { totalFindings, tradesAnalyzed };
  }

  // ----- LIVE MODE -----
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — AI generation unavailable");

  const client = new Anthropic({ apiKey });

  for (const bt of bidTrades) {
    const { systemPrompt, userPrompt, estimateCount } = await assembleGapPrompt(
      bidId,
      bt.trade.id
    );

    // Skip if no estimates and no spec context — nothing to analyze
    if (estimateCount === 0) {
      const specCount = await prisma.specSection.count({
        where: {
          specBook: { bidId },
          OR: [{ tradeId: bt.trade.id }, { matchedTradeId: bt.trade.id }],
        },
      });
      if (specCount === 0) continue;
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: await getMaxTokens("gap-analysis"),
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") continue;

    const raw = textBlock.text
      .trim()
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    let findings: RawGapFinding[];
    try {
      findings = JSON.parse(raw);
      if (!Array.isArray(findings)) continue;
    } catch {
      console.error(`[gap-analysis] Failed to parse AI response for trade ${bt.trade.name}`);
      continue;
    }

    const count = await saveFindingsForTrade(bidId, bt.trade.id, bt.trade.name, findings);
    totalFindings += count;
    tradesAnalyzed++;
  }

  return { totalFindings, tradesAnalyzed };
}

// ----- POST Route handler -----

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  if (
    process.env.GAP_STUB_MODE !== "true" &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set — AI generation unavailable" },
      { status: 503 }
    );
  }

  let tradeIdFilter: number | undefined;
  try {
    const body = await request.json().catch(() => ({})) as { tradeId?: string };
    if (body.tradeId) {
      const parsed = parseInt(body.tradeId, 10);
      if (!isNaN(parsed)) tradeIdFilter = parsed;
    }
  } catch {
    // no body — run all trades
  }

  try {
    const { totalFindings, tradesAnalyzed } = await runGapAnalysis(bidId, tradeIdFilter);
    return Response.json({ success: true, totalFindings, tradesAnalyzed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /gap-analysis/generate] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
