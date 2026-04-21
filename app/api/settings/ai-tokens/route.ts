import { isAdminAuthorized } from "@/lib/auth";
import {
  AI_CALL_DEFINITIONS,
  CallKey,
  estimateCallCost,
  getAllCallConfigs,
  setMaxTokensOverride,
} from "@/lib/services/ai/aiTokenConfig";

// GET /api/settings/ai-tokens
// Returns all AI call configurations with current effective values + cost estimates
// for each preset.
export async function GET() {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }
  const configs = await getAllCallConfigs();

  const enriched = configs.map(({ key, definition, currentMaxTokens, isOverridden }) => {
    const presetCosts = Object.fromEntries(
      Object.entries(definition.presets).map(([presetKey, tokens]) => [
        presetKey,
        estimateCallCost(key, tokens),
      ])
    );

    return {
      key,
      label: definition.label,
      description: definition.description,
      model: definition.model,
      typicalInputTokens: definition.typicalInputTokens,
      defaultMaxTokens: definition.defaultMaxTokens,
      minTokens: definition.minTokens,
      maxAllowedTokens: definition.maxAllowedTokens,
      presets: definition.presets,
      recommended: definition.recommended,
      currentMaxTokens,
      currentCost: estimateCallCost(key, currentMaxTokens),
      isOverridden,
      presetCosts,
    };
  });

  return Response.json({ configs: enriched });
}

// PATCH /api/settings/ai-tokens
// Body: { callKey: string, maxTokens: number | null }
// maxTokens=null clears the override and reverts to the hardcoded default.
export async function PATCH(request: Request) {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  let body: { callKey?: string; maxTokens?: number | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { callKey, maxTokens } = body;

  if (!callKey || !(callKey in AI_CALL_DEFINITIONS)) {
    return Response.json(
      {
        error: `callKey must be one of: ${Object.keys(AI_CALL_DEFINITIONS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (maxTokens !== null && (typeof maxTokens !== "number" || !Number.isFinite(maxTokens))) {
    return Response.json(
      { error: "maxTokens must be a number or null" },
      { status: 400 }
    );
  }

  try {
    await setMaxTokensOverride(callKey as CallKey, maxTokens ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true });
}
