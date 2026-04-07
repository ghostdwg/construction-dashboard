import { prisma } from "@/lib/prisma";

// ----- Types -----

export type GapPromptContext = {
  systemPrompt: string;
  userPrompt: string;
  tradeName: string;
  estimateCount: number;
};

// ----- Assembler -----

export async function assembleGapPrompt(
  bidId: number,
  tradeId: number
): Promise<GapPromptContext> {
  const [bid, trade, specBook, brief, estimates] = await Promise.all([
    prisma.bid.findUnique({
      where: { id: bidId },
      select: { projectName: true, projectType: true },
    }),
    prisma.trade.findUnique({
      where: { id: tradeId },
      select: { name: true, csiCode: true },
    }),
    // Most recent spec book — sections relevant to this trade
    prisma.specBook.findFirst({
      where: { bidId },
      orderBy: { uploadedAt: "desc" },
      include: {
        sections: {
          where: {
            OR: [
              { tradeId },
              { matchedTradeId: tradeId },
            ],
          },
          select: { csiNumber: true, csiTitle: true, rawText: true },
          orderBy: { csiNumber: "asc" },
        },
      },
    }),
    prisma.bidIntelligenceBrief.findUnique({
      where: { bidId },
      select: {
        whatIsThisJob: true,
        howItGetsBuilt: true,
        riskFlags: true,
      },
    }),
    // Approved sanitized estimates from subs invited for this trade
    // Join: EstimateUpload → subcontractorId → BidInviteSelection (bidId + tradeId)
    prisma.estimateUpload.findMany({
      where: {
        bidId,
        approvedForAi: true,
        sanitizedText: { not: null },
        subcontractor: {
          selections: {
            some: { bidId, tradeId },
          },
        },
      },
      select: { subToken: true, sanitizedText: true },
      orderBy: { uploadedAt: "asc" },
    }),
  ]);

  if (!bid) throw new Error(`Bid ${bidId} not found`);
  if (!trade) throw new Error(`Trade ${tradeId} not found`);

  const tradeName = trade.name;
  const projectType = bid.projectType ?? "PRIVATE";

  // ----- Section A — Project + trade identity -----
  const sectionA = [
    `BID: ${bid.projectName}`,
    `TRADE: ${tradeName}${trade.csiCode ? ` (CSI ${trade.csiCode})` : ""}`,
    `PROJECT TYPE: ${projectType}`,
  ].join("\n");

  // ----- Section B — Brief context (what the job is, how it gets built) -----
  let sectionB = "";
  if (brief) {
    const parts: string[] = ["PROJECT INTELLIGENCE BRIEF:"];
    if (brief.whatIsThisJob) parts.push(`What is this job: ${brief.whatIsThisJob}`);
    if (brief.howItGetsBuilt) parts.push(`How it gets built: ${brief.howItGetsBuilt}`);

    // Include risk flags relevant to this trade
    if (brief.riskFlags) {
      try {
        const flags = JSON.parse(brief.riskFlags) as {
          flag: string;
          severity: string;
          foundIn: string;
        }[];
        if (flags.length > 0) {
          parts.push("Risk flags from project brief:");
          for (const f of flags) {
            parts.push(`  [${f.severity.toUpperCase()}] ${f.flag} (Source: ${f.foundIn})`);
          }
        }
      } catch {
        // ignore parse errors
      }
    }
    sectionB = parts.join("\n");
  }

  // ----- Section C — Spec sections for this trade -----
  let sectionC = "";
  if (specBook && specBook.sections.length > 0) {
    const lines = [`SPECIFICATION SECTIONS FOR ${tradeName.toUpperCase()}:`];
    for (const s of specBook.sections) {
      const preview = s.rawText?.slice(0, 400).replace(/\s+/g, " ").trim();
      lines.push(`  ${s.csiNumber} — ${s.csiTitle}`);
      if (preview) lines.push(`    Excerpt: ${preview}${s.rawText.length > 400 ? "…" : ""}`);
    }
    sectionC = lines.join("\n");
  }

  // ----- Section D — Sanitized estimate scope descriptions -----
  let sectionD = "";
  const validEstimates = estimates.filter((e) => e.sanitizedText);
  if (validEstimates.length > 0) {
    sectionD = [
      "SANITIZED SCOPE SUBMISSIONS FROM SUB ESTIMATES:",
      "(Note: Pricing removed. Sub identity removed. Scope descriptions only.)",
      "",
      ...validEstimates.map((e, i) => {
        const token = e.subToken ?? `SUB-${i + 1}`;
        return `${token} SCOPE:\n${e.sanitizedText}`;
      }),
    ].join("\n");
  }

  // ----- Section E — projectType-specific framing -----
  let projectTypeFrame = "";
  if (projectType === "PUBLIC") {
    projectTypeFrame =
      "Flag any compliance-related scope gaps — prevailing wage requirements, certified testing, " +
      "special inspection requirements per Division 1, DBE/MBE requirements, and bonding scope.";
  } else if (projectType === "PRIVATE") {
    projectTypeFrame =
      "Flag value engineering opportunities where scope descriptions suggest a cheaper alternative " +
      "may be acceptable per spec. Flag owner confirmation items before the invite goes out.";
  } else if (projectType === "NEGOTIATED") {
    projectTypeFrame =
      "Flag scope items that could affect the GMP. Flag ambiguous scope language that needs " +
      "owner alignment before the GMP is locked. Identify phasing flexibility where present.";
  }

  // ----- Section F — Task and output format -----
  const sectionF = [
    "TASK:",
    `Identify scope gaps for the ${tradeName} trade.`,
    "A gap is something the contract documents require that is absent or ambiguous across the submitted estimate scope descriptions.",
    "Ground every finding in a specific document reference — do not infer gaps without document support.",
    "If no estimates were provided, identify what the spec requires that should be priced.",
    projectTypeFrame ? `\n${projectTypeFrame}` : "",
    "",
    "Return a raw JSON array only — no markdown, no preamble, no explanation:",
    `[
  {
    "severity": "CRITICAL" | "MODERATE" | "LOW",
    "title": "Short gap title (max 10 words)",
    "description": "What is missing and why it matters",
    "sourceRef": "Spec section X.X.X or Drawing discipline",
    "suggestedQuestion": "Clarification question to send to the sub",
    "foundIn": "SPEC_BOOK" | "DRAWINGS" | "BOTH" | "BRIEF"
  }
]`,
    "Sort results: CRITICAL first, then MODERATE, then LOW.",
    "Be specific. Do not produce generic construction advice.",
    "Do not reference sub names, company identities, or pricing.",
  ]
    .filter(Boolean)
    .join("\n");

  // ----- Assemble -----
  const promptSections: string[] = [sectionA];
  if (sectionB) promptSections.push(sectionB);
  if (sectionC) promptSections.push(sectionC);
  if (sectionD) promptSections.push(sectionD);
  promptSections.push(sectionF);

  const userPrompt = promptSections.join("\n\n---\n\n");

  const systemPrompt =
    "You are a senior preconstruction estimator performing per-trade scope gap analysis for a " +
    "commercial general contractor. You compare contract document requirements against sanitized " +
    "subcontractor scope submissions to identify what is missing or ambiguous. " +
    "Every finding must reference a specific document — never guess. " +
    "Do not reference sub names, company identities, or pricing data. " +
    "Respond with a raw JSON array only — no markdown fences, no explanation.";

  return {
    systemPrompt,
    userPrompt,
    tradeName,
    estimateCount: validEstimates.length,
  };
}
