import { prisma } from "@/lib/prisma";

// ----- Types -----

export type ReviewPromptContext = {
  systemPrompt: string;
  userPrompt: string;
  // Coverage summary — surfaced in the UI
  coverage: {
    hasSpecBook: boolean;
    specSectionCount: number;
    hasDrawings: boolean;
    drawingSheetCount: number;
    approvedEstimateCount: number;
  };
};

// ----- Assembler -----

export async function assembleReviewPrompt(bidId: number): Promise<ReviewPromptContext> {
  // Load everything in parallel
  const [bid, specBook, drawingUpload, estimates] = await Promise.all([
    prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        bidTrades: { include: { trade: { select: { name: true, csiCode: true } } } },
      },
    }),
    prisma.specBook.findFirst({
      where: { bidId },
      orderBy: { uploadedAt: "desc" },
      include: {
        sections: {
          orderBy: { csiNumber: "asc" },
          select: {
            csiNumber: true,
            csiTitle: true,
            tradeId: true,
            matchedTradeId: true,
          },
        },
      },
    }),
    prisma.drawingUpload.findFirst({
      where: { bidId },
      orderBy: { uploadedAt: "desc" },
      include: {
        sheets: {
          select: {
            discipline: true,
            tradeId: true,
            matchedTradeId: true,
            trade: { select: { name: true } },
            matchedTrade: { select: { name: true } },
          },
        },
      },
    }),
    prisma.estimateUpload.findMany({
      where: {
        bidId,
        approvedForAi: true,
        sanitizationStatus: "complete",
        parseStatus: "complete",
      },
      select: {
        subToken: true,
        sanitizedText: true,
      },
      orderBy: { uploadedAt: "asc" },
    }),
  ]);

  if (!bid) throw new Error(`Bid ${bidId} not found`);

  const tradeNames = bid.bidTrades.map((bt) => bt.trade.name);

  // ----- Section A — Project context -----
  const sectionA = [
    `BID: ${bid.projectName}`,
    `TRADES ASSIGNED: ${tradeNames.length > 0 ? tradeNames.join(", ") : "None assigned"}`,
  ].join("\n");

  // ----- Section B — Spec book -----
  let sectionB = "";
  let specSectionCount = 0;
  if (specBook && specBook.sections.length > 0) {
    specSectionCount = specBook.sections.length;

    // Covered = tradeId set (trade is on bid)
    const coveredSections = specBook.sections.filter((s) => s.tradeId !== null);
    // Matched but not on bid (matchedTradeId set, tradeId null)
    const missingSections = specBook.sections.filter(
      (s) => s.tradeId === null && s.matchedTradeId !== null
    );
    // Unknown — both null
    const unknownSections = specBook.sections.filter(
      (s) => s.tradeId === null && s.matchedTradeId === null
    );

    const formatSection = (s: { csiNumber: string; csiTitle: string }) =>
      `  ${s.csiNumber} — ${s.csiTitle}`;

    const lines: string[] = ["SPECIFICATION SECTIONS REQUIRED:"];

    if (coveredSections.length > 0) {
      lines.push("  [Covered by assigned trades]");
      coveredSections.forEach((s) => lines.push(formatSection(s)));
    }

    if (missingSections.length > 0) {
      lines.push("SPECIFICATION GAPS (trade not on bid):");
      missingSections.forEach((s) => lines.push(formatSection(s)));
    }

    if (unknownSections.length > 0) {
      lines.push("SPECIFICATION SECTIONS — UNMATCHED:");
      unknownSections.forEach((s) => lines.push(formatSection(s)));
    }

    sectionB = lines.join("\n");
  }

  // ----- Section C — Drawings -----
  let sectionC = "";
  let drawingSheetCount = 0;
  if (drawingUpload && drawingUpload.sheets.length > 0) {
    drawingSheetCount = drawingUpload.sheets.length;

    // Unique disciplines present
    const disciplines = [
      ...new Set(
        drawingUpload.sheets
          .map((s) => s.discipline)
          .filter((d): d is string => d !== null)
      ),
    ].sort();

    // Trade names found from drawings (covered + missing)
    const tradeNamesFromDrawings = [
      ...new Set(
        drawingUpload.sheets
          .map((s) => s.trade?.name ?? s.matchedTrade?.name)
          .filter((n): n is string => n !== undefined)
      ),
    ].sort();

    // Disciplines with no trade on bid
    const missingDisciplines = drawingUpload.sheets
      .filter((s) => s.tradeId === null && s.matchedTradeId !== null)
      .map((s) => s.discipline)
      .filter((d): d is string => d !== null);
    const uniqueMissingDisciplines = [...new Set(missingDisciplines)].sort();

    const lines: string[] = [
      "DRAWING DISCIPLINES ON PROJECT:",
      disciplines.map((d) => `  ${d}`).join("\n"),
      "TRADES IDENTIFIED FROM DRAWINGS:",
      tradeNamesFromDrawings.map((t) => `  ${t}`).join("\n"),
    ];

    if (uniqueMissingDisciplines.length > 0) {
      lines.push(
        "DRAWING DISCIPLINES WITH NO TRADE ON BID:",
        uniqueMissingDisciplines.map((d) => `  ${d}`).join("\n")
      );
    }

    sectionC = lines.join("\n");
  }

  // ----- Section D — Sub scope submissions -----
  const approvedEstimates = estimates.filter((e) => e.sanitizedText);
  const sectionD = approvedEstimates
    .map((e) => {
      const token = e.subToken ?? "SUB-UNKNOWN";
      return `SUB ${token} SCOPE SUBMISSION:\n${e.sanitizedText}`;
    })
    .join("\n\n---\n\n");

  // ----- Section E — Analysis request -----
  const sectionE = `Based on the specification sections and drawing disciplines listed above, identify:
1. Scope items required by the documents that are absent from all sub submissions
2. Scope items present in only one submission that should be confirmed by others
3. Vague or summary language ("per plans and addendum") that requires follow-up clarification
4. Any drawing disciplines with no corresponding sub scope coverage

Format findings as a JSON array with no surrounding text, no markdown fences — raw JSON only:
[{
  "finding": "string",
  "severity": "critical" | "moderate" | "low",
  "affectedTrade": "string",
  "sourceDocument": "specbook" | "drawings" | "both" | "none",
  "suggestedQuestion": "string"
}]`;

  // ----- Assemble user prompt -----
  const promptSections: string[] = [sectionA];
  if (sectionB) promptSections.push(sectionB);
  if (sectionC) promptSections.push(sectionC);
  if (sectionD) promptSections.push(sectionD);
  promptSections.push(sectionE);

  const userPrompt = promptSections.join("\n\n---\n\n");

  const systemPrompt =
    "You are a preconstruction review assistant for a general contractor. " +
    "You will be given project document context and subcontractor scope submissions. " +
    "Your job is to identify scope gaps — items required by the project documents that " +
    "are absent or insufficiently covered in the sub submissions. " +
    "Do not reference sub names or company identities. Do not infer pricing. " +
    "Focus only on scope coverage. " +
    "Respond with a raw JSON array only — no markdown, no explanation, no code fences.";

  return {
    systemPrompt,
    userPrompt,
    coverage: {
      hasSpecBook: specBook !== null,
      specSectionCount,
      hasDrawings: drawingUpload !== null,
      drawingSheetCount,
      approvedEstimateCount: approvedEstimates.length,
    },
  };
}
