import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

// POST /api/bids/[id]/leveling/[rowId]/question
// Creates a GeneratedQuestion from a LevelingRow marked clarification_needed.
// Uses Claude to draft the question text from scope context (no sub identity, no pricing).
// Idempotent: returns existing question if one already exists for this row.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const { id, rowId } = await params;
  const bidId = parseInt(id, 10);
  const rowIdNum = parseInt(rowId, 10);

  if (isNaN(bidId) || isNaN(rowIdNum)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  // Verify row belongs to this bid's session, load trade and bid name
  const row = await prisma.levelingRow.findFirst({
    where: { id: rowIdNum, session: { bidId } },
    include: {
      trade: { select: { name: true } },
      session: {
        include: { bid: { select: { id: true, projectName: true } } },
      },
    },
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  // Idempotent: return existing question if already created for this row
  const existing = await prisma.generatedQuestion.findFirst({
    where: { levelingRowId: rowIdNum },
  });
  if (existing) return Response.json(existing, { status: 200 });

  // Draft question text via Claude — falls back to template if key not set
  const questionText = await draftQuestion({
    scopeText: row.scopeText,
    division: row.division,
    tradeName: row.trade?.name ?? null,
    projectName: row.session.bid.projectName,
  });

  const question = await prisma.generatedQuestion.create({
    data: {
      bidId,
      levelingRowId: rowIdNum,
      tradeName: row.trade?.name ?? null,
      questionText,
      isInternal: false,
      status: "OPEN",
    },
  });

  return Response.json(question, { status: 201 });
}

async function draftQuestion({
  scopeText,
  division,
  tradeName,
  projectName,
}: {
  scopeText: string;
  division: string;
  tradeName: string | null;
  projectName: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return templateQuestion(scopeText);
  }

  const client = new Anthropic({ apiKey });

  const divisionContext = division
    ? `CSI Division reference: ${division}\n`
    : "";
  const tradeContext = tradeName ? `Trade: ${tradeName}\n` : "";

  const prompt = `You are a preconstruction estimator reviewing subcontractor scope of work for bid leveling.

Project: ${projectName}
${tradeContext}${divisionContext}
The following scope item in a subcontractor estimate has been flagged for clarification:

"${scopeText}"

Draft a single, direct question to send to the subcontractor. The question must:
- Ask the sub to confirm whether this specific scope item is included in their base bid
- Request confirmation of what is and is not included if ambiguous
- Be specific to the scope item described above
- Be professional and concise (1–2 sentences maximum)
- Contain no dollar amounts, unit prices, or reference to pricing

Return only the question text. No preamble, no explanation.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type === "text" && content.text.trim()) {
      return content.text.trim();
    }
    return templateQuestion(scopeText);
  } catch (err) {
    console.error("[draftQuestion] Claude API error:", err);
    return templateQuestion(scopeText);
  }
}

function templateQuestion(scopeText: string): string {
  return `Please confirm whether the following scope item is included in your base bid: "${scopeText}". If included, please confirm it is in your base scope. If excluded, please advise.`;
}
