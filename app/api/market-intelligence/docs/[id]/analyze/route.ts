// POST /api/market-intelligence/docs/[id]/analyze
//
// Fire an on-demand engine analysis (Claude or Ollama) against a scraped doc's
// raw text. Stores the result in MarketDocAnalysis so the user can re-run with
// different engines and compare outputs.
//
// Body: { engine: "claude" | "ollama", model?: string }
// Returns: the MarketDocAnalysis row (status=complete or failed).

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";

type Body = {
  engine?: string;
  model?: string;
};

type SidecarAnalyzeResponse = {
  engine: string;
  model: string;
  duration_ms: number;
  cost_usd: number;
  input_tokens?: number;
  output_tokens?: number;
  signals_count: number;
  leads_count?: number;
  jurisdiction?: string | null;
  document_date?: string | null;
  raw_response: Record<string, unknown>;
  error?: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  let body: Body = {};
  try { body = (await request.json()) as Body; } catch { /* allow empty */ }

  const engine = (body.engine || "").toLowerCase();
  if (engine !== "claude" && engine !== "ollama") {
    return Response.json({ error: "engine must be 'claude' or 'ollama'" }, { status: 400 });
  }
  const requestedModel = body.model || (engine === "claude" ? DEFAULT_CLAUDE_MODEL : DEFAULT_OLLAMA_MODEL);

  // Option A (docs/architecture/adr/0001-ai-credential-resolution.md,
  // docs/architecture/adr/0002-remaining-sidecar-credential-targets.md):
  // resolve the Anthropic credential here and forward it explicitly to the
  // sidecar — the sidecar never resolves its own. Only the "claude" engine
  // needs it; the "ollama" branch runs local inference with no Anthropic
  // credential, so it is left untouched. Fail closed with a 503 before
  // creating the running analysis row so a missing key never leaves a
  // dangling job. This is the one market endpoint caller that talks to the
  // sidecar directly rather than through sidecarMarket.ts.
  let apiKey = "";
  if (engine === "claude") {
    const resolved = await getSetting("ANTHROPIC_API_KEY");
    if (!resolved) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration" },
        { status: 503 }
      );
    }
    apiKey = resolved;
  }

  const doc = await prisma.marketSourceDoc.findUnique({
    where: { id },
    select: { id: true, rawText: true, jurisdiction: true, documentDate: true },
  });
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });
  if (!doc.rawText || !doc.rawText.trim()) {
    return Response.json({ error: "Document has no rawText to analyze (re-scrape first)" }, { status: 422 });
  }

  // Insert the analysis row up front so the UI/poller can see it as 'running'
  // even if the sidecar call hangs.
  const analysis = await prisma.marketDocAnalysis.create({
    data: {
      docId: doc.id,
      engine,
      modelName: requestedModel,
      status: "running",
      startedAt: new Date(),
    },
  });

  const sidecarHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) sidecarHeaders["X-API-Key"] = SIDECAR_API_KEY;

  const payload = {
    text: doc.rawText,
    engine,
    model: requestedModel,
    jurisdiction: doc.jurisdiction ?? null,
    source_date: doc.documentDate ? doc.documentDate.toISOString().slice(0, 10) : null,
    api_key: apiKey,
  };

  // 3 min server-side cap covers Ollama's slowest typical run on qwen2.5:14b.
  const ABORT_MS = 3 * 60 * 1000;

  try {
    const res = await fetch(`${SIDECAR_URL}/market/analyze-text`, {
      method: "POST",
      headers: sidecarHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ABORT_MS),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`sidecar HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await res.json()) as SidecarAnalyzeResponse;

    const updated = await prisma.marketDocAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "complete",
        completedAt: new Date(),
        durationMs: data.duration_ms,
        costUsd: data.cost_usd ?? 0,
        signalsCount: data.signals_count ?? 0,
        leadsCount: data.leads_count ?? 0,
        rawResponseJson: JSON.stringify(data.raw_response ?? {}),
        modelName: data.model || requestedModel,
      },
    });

    return Response.json({ analysis: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await prisma.marketDocAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: message.slice(0, 1000),
      },
    });
    return Response.json({ analysis: failed, error: message }, { status: 502 });
  }
}
