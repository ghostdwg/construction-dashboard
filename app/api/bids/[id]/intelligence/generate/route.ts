import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { assembleReviewPrompt } from "@/lib/services/ai/assembleReviewPrompt";
import { getMaxTokens } from "@/lib/services/ai/aiTokenConfig";
import { logAiUsage } from "@/lib/services/ai/aiUsageLog";
import { getSetting } from "@/lib/services/settings/appSettingsService";

// ----- Shared generation logic (importable from upload routes) -----

type RawFinding = {
  finding?: string;
  severity?: string;
  affectedTrade?: string;
  sourceDocument?: string;
  suggestedQuestion?: string;
};

export async function generateBidIntelligence(bidId: number): Promise<{
  findingCount: number;
  coverage: Awaited<ReturnType<typeof assembleReviewPrompt>>["coverage"];
}> {
  const apiKey = await getSetting("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — configure it in /settings → AI Configuration (or .env.local)"
    );
  }

  const { systemPrompt, userPrompt, coverage } = await assembleReviewPrompt(bidId);

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: await getMaxTokens("intelligence"),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  await logAiUsage({
    callKey: "intelligence",
    model: "claude-sonnet-4-6",
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    bidId,
  });

  // Extract text block from response
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content");
  }

  // Strip markdown fences if the model wrapped the JSON anyway
  const raw = textBlock.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let findings: RawFinding[];
  try {
    findings = JSON.parse(raw);
    if (!Array.isArray(findings)) throw new Error("Response is not an array");
  } catch {
    throw new Error(`Failed to parse AI response as JSON: ${raw.slice(0, 200)}`);
  }

  // Validate severity and sourceDocument values
  const VALID_SEVERITY = new Set(["critical", "moderate", "low"]);
  const VALID_SOURCE = new Set(["specbook", "drawings", "both", "none"]);

  // Delete previous AI-generated findings for this bid so each run is a fresh analysis
  await prisma.aiGapFinding.deleteMany({ where: { bidId } });

  // Bulk create new findings
  const created = await prisma.$transaction(
    findings
      .filter((f) => f.finding && f.finding.trim().length > 0)
      .map((f) =>
        prisma.aiGapFinding.create({
          data: {
            bidId,
            findingText: f.finding!.trim(),
            tradeName: f.affectedTrade?.trim() || null,
            severity: VALID_SEVERITY.has(f.severity ?? "") ? f.severity : null,
            sourceDocument: VALID_SOURCE.has(f.sourceDocument ?? "") ? f.sourceDocument : null,
            reviewNotes: f.suggestedQuestion?.trim() || null,
            status: "pending_review",
          },
        })
      )
  );

  return { findingCount: created.length, coverage };
}

// ----- GET — coverage summary only (no AI call) -----

// GET /api/bids/[id]/intelligence/generate
// Returns document coverage counts so the UI can show the summary banner
// without triggering a generation.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  try {
    const { coverage } = await assembleReviewPrompt(bidId);
    return Response.json(coverage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// ----- POST — Route handler -----

// POST /api/bids/[id]/intelligence/generate
// Assembles full prompt context, calls Claude, stores AiGapFinding records.
// Returns { success, findingCount, coverage }.
// If ANTHROPIC_API_KEY is not set, returns 503.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  if (!(await getSetting("ANTHROPIC_API_KEY"))) {
    return Response.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set — configure it in /settings → AI Configuration (or .env.local)",
      },
      { status: 503 }
    );
  }

  try {
    const { findingCount, coverage } = await generateBidIntelligence(bidId);
    return Response.json({ success: true, findingCount, coverage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /intelligence/generate] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
