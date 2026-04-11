// GET  /api/settings/ai-forecast?callKey=brief[&bidId=123]
// POST /api/settings/ai-forecast { callKey, inputText? }
//
// Module SET1 — Cost forecast for an AI call.
//
// GET supports preset call keys + optional bidId. When bidId is provided
// for "brief" or "intelligence", we assemble the *actual* prompt for that
// bid and tokenize it for an accurate forecast. Other calls fall back to
// the call definition's typicalInputTokens.
//
// POST accepts an arbitrary inputText for ad-hoc estimation.

import { forecastCallCost } from "@/lib/services/ai/tokenEstimator";
import { AI_CALL_DEFINITIONS, type CallKey } from "@/lib/services/ai/aiTokenConfig";
import { assembleBriefPrompt } from "@/lib/services/ai/assembleBriefPrompt";
import { assembleReviewPrompt } from "@/lib/services/ai/assembleReviewPrompt";

function isValidCallKey(s: string): s is CallKey {
  return s in AI_CALL_DEFINITIONS;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const callKey = searchParams.get("callKey");
  const bidIdRaw = searchParams.get("bidId");

  if (!callKey || !isValidCallKey(callKey)) {
    return Response.json(
      {
        error: `callKey must be one of: ${Object.keys(AI_CALL_DEFINITIONS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const bidId = bidIdRaw ? parseInt(bidIdRaw, 10) : null;

  try {
    let inputText: string | undefined;

    if (bidId != null && Number.isFinite(bidId)) {
      // Assemble the actual prompt for an accurate forecast
      if (callKey === "brief") {
        const prompt = await assembleBriefPrompt(bidId);
        inputText = prompt.systemPrompt + "\n" + prompt.userPrompt;
      } else if (callKey === "intelligence") {
        const prompt = await assembleReviewPrompt(bidId);
        inputText = prompt.systemPrompt + "\n" + prompt.userPrompt;
      }
      // gap-analysis / addendum-delta / leveling-question are per-trade /
      // per-addendum / per-row, so a per-bid forecast doesn't make sense
      // without more context. Fall back to typicalInputTokens.
    }

    const forecast = await forecastCallCost({ callKey, inputText });
    return Response.json(forecast);
  } catch (err) {
    console.error("[GET /api/settings/ai-forecast]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { callKey?: string; inputText?: string; overrideMaxTokens?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.callKey || !isValidCallKey(body.callKey)) {
    return Response.json(
      {
        error: `callKey must be one of: ${Object.keys(AI_CALL_DEFINITIONS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const forecast = await forecastCallCost({
      callKey: body.callKey,
      inputText: body.inputText,
      overrideMaxTokens: body.overrideMaxTokens,
    });
    return Response.json(forecast);
  } catch (err) {
    console.error("[POST /api/settings/ai-forecast]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
