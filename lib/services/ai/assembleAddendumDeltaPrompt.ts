// ----- Types -----

type BriefContext = {
  whatIsThisJob: string | null;
  riskFlags: string | null; // JSON string
};

type PreviousDeltaSummary = {
  addendumNumber: number;
  summary: string;
};

type DeltaPromptInput = {
  bid: { projectType: string };
  existingBrief: BriefContext;
  addendumText: string;
  previousDeltas: PreviousDeltaSummary[];
};

type DeltaPromptResult = {
  systemPrompt: string;
  userPrompt: string;
};

// ----- Helpers -----

function parseRiskFlagTitles(riskFlagsJson: string | null): string[] {
  if (!riskFlagsJson) return [];
  try {
    const flags = JSON.parse(riskFlagsJson) as { flag?: string }[];
    return flags.map((f) => f.flag ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

// ----- Assembler -----

export function assembleAddendumDeltaPrompt(input: DeltaPromptInput): DeltaPromptResult {
  const { bid, existingBrief, addendumText, previousDeltas } = input;

  // ----- System prompt -----
  const systemPrompt =
    "You are a senior preconstruction estimator reviewing an addendum to a project you are actively " +
    "bidding. You have the original project intelligence brief as context. Your job is to identify " +
    "only what CHANGED and what the estimator needs to DO about it. Do not re-summarize the entire " +
    "project. Do not repeat information from the original brief unless it was directly changed by " +
    "this addendum. Output valid JSON only — no preamble, no markdown.";

  // ----- Build user prompt sections -----

  // Section 1 — original brief summary
  const briefSummaryLines: string[] = ["ORIGINAL PROJECT BRIEF SUMMARY:"];
  if (existingBrief.whatIsThisJob) {
    // Trim to ~3 sentences
    const sentences = existingBrief.whatIsThisJob.split(/(?<=[.!?])\s+/);
    briefSummaryLines.push(sentences.slice(0, 3).join(" "));
  } else {
    briefSummaryLines.push("(No project summary available)");
  }

  const riskTitles = parseRiskFlagTitles(existingBrief.riskFlags);
  if (riskTitles.length > 0) {
    briefSummaryLines.push("\nExisting risk flags (titles only):");
    for (const title of riskTitles) {
      briefSummaryLines.push(`  - ${title}`);
    }
  }

  const section1 = briefSummaryLines.join("\n");

  // Section 2 — previous addenda processed
  let section2: string;
  if (previousDeltas.length === 0) {
    section2 = "PREVIOUS ADDENDA PROCESSED:\nNone — this is the first addendum.";
  } else {
    const lines = ["PREVIOUS ADDENDA PROCESSED:"];
    for (const d of previousDeltas) {
      lines.push(`  Addendum ${d.addendumNumber}: ${d.summary}`);
    }
    section2 = lines.join("\n");
  }

  // Section 3 — addendum content
  const section3 = `ADDENDUM CONTENT:\n${addendumText || "(no text extracted from this addendum)"}`;

  // Section 4 — project type framing
  const projectType = bid.projectType ?? "PRIVATE";
  let section4 = `PROJECT TYPE: ${projectType}`;
  if (projectType === "PUBLIC") {
    section4 +=
      "\nFlag any compliance impacts — changes to bonding requirements, prevailing wage, " +
      "DBE scope, liquidated damages, or bid deadline.";
  } else if (projectType === "PRIVATE") {
    section4 +=
      "\nFlag any scope changes that create VE opportunities or require owner confirmation.";
  }

  // Section 5 — task / output schema
  const section5 = `TASK:
Analyze this addendum and return a JSON delta object with exactly this structure:
{
  "addendumNumber": number,
  "dateIssued": "YYYY-MM-DD or null",
  "summary": "One sentence — what this addendum is about",
  "changesIdentified": number,
  "scopeChanges": [
    {
      "type": "MODIFICATION | ADDITION | DELETION | SUBSTITUTION",
      "description": "string",
      "location": "string",
      "costImpact": "INCREASE | DECREASE | NONE | UNKNOWN",
      "scheduleImpact": "INCREASE | DECREASE | NONE | UNKNOWN",
      "actionRequired": "string"
    }
  ],
  "clarifications": [
    {
      "description": "string",
      "location": "string",
      "actionRequired": "string"
    }
  ],
  "newRisks": [
    {
      "severity": "CRITICAL | MODERATE | LOW",
      "description": "string",
      "sourceRef": "string",
      "recommendedAction": "string"
    }
  ],
  "resolvedItems": ["string"],
  "netCostDirection": "INCREASE | DECREASE | NEUTRAL",
  "netScheduleDirection": "INCREASE | DECREASE | NEUTRAL",
  "actionsRequired": [
    "Specific action the estimator must take"
  ]
}

Only include sections that have content. Empty arrays are fine for sections with no changes.
actionsRequired must be specific and actionable — not generic advice.
changesIdentified is the total count of scope changes + clarifications + new risks.`;

  const userPrompt = [section1, section2, section3, section4, section5].join("\n\n---\n\n");

  return { systemPrompt, userPrompt };
}
