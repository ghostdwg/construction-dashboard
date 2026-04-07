import { prisma } from "@/lib/prisma";

// ----- Types -----

export type BriefPromptContext = {
  systemPrompt: string;
  userPrompt: string;
  sourceContext: {
    division1Detected: boolean;
    specSectionCount: number;
    drawingDisciplines: string[];
    addendumCount: number;
  };
};

// ----- Assembler -----

export async function assembleBriefPrompt(bidId: number): Promise<BriefPromptContext> {
  const [bid, specBook, drawingUpload, addendums] = await Promise.all([
    prisma.bid.findUnique({
      where: { id: bidId },
      include: {
        bidTrades: { include: { trade: { select: { name: true } } } },
      },
    }),
    prisma.specBook.findFirst({
      where: { bidId },
      orderBy: { uploadedAt: "desc" },
      include: {
        sections: {
          orderBy: { csiNumber: "asc" },
          select: { csiNumber: true, csiTitle: true, rawText: true },
        },
      },
    }),
    prisma.drawingUpload.findFirst({
      where: { bidId },
      orderBy: { uploadedAt: "desc" },
      include: {
        sheets: {
          select: { discipline: true, sheetNumber: true },
        },
      },
    }),
    prisma.addendumUpload.findMany({
      where: { bidId, status: "ready" },
      orderBy: { addendumNumber: "asc" },
      select: {
        addendumNumber: true,
        addendumDate: true,
        fileName: true,
        extractedText: true,
      },
    }),
  ]);

  if (!bid) throw new Error(`Bid ${bidId} not found`);

  const tradeNames = bid.bidTrades.map((bt) => bt.trade.name);

  // ----- Division 1 detection -----
  const div1Sections = specBook?.sections.filter((s) =>
    s.csiNumber.startsWith("01")
  ) ?? [];
  const division1Detected = div1Sections.length > 0;
  const nonDiv1Sections = specBook?.sections.filter((s) =>
    !s.csiNumber.startsWith("01")
  ) ?? [];

  // ----- Drawing disciplines -----
  const disciplineSheetCount: Record<string, number> = {};
  for (const sheet of drawingUpload?.sheets ?? []) {
    if (sheet.discipline) {
      disciplineSheetCount[sheet.discipline] =
        (disciplineSheetCount[sheet.discipline] ?? 0) + 1;
    }
  }
  const drawingDisciplines = Object.keys(disciplineSheetCount).sort();

  // ----- Section A — Project identity -----
  const sectionA = [
    `BID: ${bid.projectName}`,
    `TRADES ASSIGNED SO FAR: ${tradeNames.length > 0 ? tradeNames.join(", ") : "none confirmed yet"}`,
  ].join("\n");

  // ----- Section B — Division 1 (full rawText) -----
  let sectionB = "";
  if (division1Detected) {
    const div1Text = div1Sections
      .map((s) => `[${s.csiNumber} — ${s.csiTitle}]\n${s.rawText}`)
      .join("\n\n");
    sectionB = [
      "DIVISION 1 — GENERAL REQUIREMENTS:",
      div1Text,
      "This defines how the job runs — contract type, schedule, owner and sub requirements,",
      "bonding, insurance, certified payroll, DBE requirements, allowances, liquidated damages,",
      "special inspections, temporary facilities, phasing.",
    ].join("\n");
  }

  // ----- Section C — Technical spec sections (titles only, grouped by division) -----
  let sectionC = "";
  if (nonDiv1Sections.length > 0) {
    // Group by first two digits of CSI number (division)
    const divisionMap = new Map<string, typeof nonDiv1Sections>();
    for (const s of nonDiv1Sections) {
      const divKey = s.csiNumber.slice(0, 2);
      if (!divisionMap.has(divKey)) divisionMap.set(divKey, []);
      divisionMap.get(divKey)!.push(s);
    }
    const lines: string[] = ["SPECIFICATION SECTIONS BY DIVISION:"];
    for (const [div, sections] of Array.from(divisionMap.entries()).sort()) {
      lines.push(`  Division ${div}:`);
      for (const s of sections) {
        lines.push(`    ${s.csiNumber} — ${s.csiTitle}`);
      }
    }
    sectionC = lines.join("\n");
  }

  // ----- Section D — Drawing disciplines -----
  let sectionD = "";
  if (drawingDisciplines.length > 0) {
    const lines = ["DRAWING INDEX:"];
    for (const disc of drawingDisciplines) {
      lines.push(`  ${disc}: ${disciplineSheetCount[disc]} sheet(s)`);
    }
    sectionD = lines.join("\n");
  }

  // ----- Section E — Addendums -----
  let sectionE = "";
  if (addendums.length > 0) {
    sectionE = addendums
      .map((a) => {
        const dateStr = a.addendumDate
          ? new Date(a.addendumDate).toLocaleDateString()
          : "date unknown";
        return `ADDENDUM ${a.addendumNumber} — ${dateStr}:\n${a.extractedText ?? "(no text extracted)"}`;
      })
      .join("\n\n---\n\n");
  }

  // ----- Section F — Output instructions -----
  const sectionF = `Respond with ONLY a valid JSON object.
No preamble, no markdown fences, no explanation.
{
  "whatIsThisJob": "string",
  "howItGetsBuilt": "string",
  "riskFlags": [{
    "flag": "string",
    "severity": "critical" | "moderate" | "low",
    "foundIn": "string",
    "potentialImpact": "string",
    "confirmBefore": "string"
  }],
  "assumptionsToResolve": [{
    "assumption": "string",
    "sourceRef": "string",
    "urgency": "before_invite" | "before_bid_day" | "post_award"
  }],
  "addendumSummary": [{
    "addendumNumber": number,
    "addendumDate": "string",
    "changes": "string",
    "supersedes": "string",
    "riskFlags": ["string"]
  }]
}
Be specific. Reference actual section numbers, sheet prefixes, and addendum numbers.
Do not produce generic construction advice.
riskFlags must be sorted critical first.
If no addendums were provided, return addendumSummary as an empty array.`;

  // ----- Assemble -----
  const promptSections: string[] = [sectionA];
  if (sectionB) promptSections.push(sectionB);
  if (sectionC) promptSections.push(sectionC);
  if (sectionD) promptSections.push(sectionD);
  if (sectionE) promptSections.push(sectionE);
  promptSections.push(sectionF);

  const userPrompt = promptSections.join("\n\n---\n\n");

  const systemPrompt =
    "You are a senior preconstruction estimator reviewing a new bid package for a commercial " +
    "general contractor. Your job is to read the project documents and produce a structured " +
    "intelligence brief for the estimating team. Focus on Division 1 requirements, schedule " +
    "and sequencing constraints, owner requirements, risk factors, addendum changes, and " +
    "assumptions that must be resolved before the bid goes out. Be specific — reference actual " +
    "spec sections, sheet numbers, and addendum numbers. Do not be generic. Think like someone " +
    "who has built 200 commercial projects and knows exactly where jobs go wrong.";

  return {
    systemPrompt,
    userPrompt,
    sourceContext: {
      division1Detected,
      specSectionCount: specBook?.sections.length ?? 0,
      drawingDisciplines,
      addendumCount: addendums.length,
    },
  };
}
