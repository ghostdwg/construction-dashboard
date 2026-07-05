import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import {
  classifySignal,
  type SignalContext,
  type HeuristicResult,
  type SignalClassification,
} from "./signalHeuristics";
import {
  recordSignalSuppression,
  recordSignalClassification,
} from "@/lib/observability";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

type SidecarSignal = {
  signal_type: string;
  signal_subtype?: string | null;       // Phase 5K: SUP_CUP|REZONING|PLAT|VARIANCE|SITE_PLAN|...
  next_meeting_date?: string | null;    // Phase 5K: ISO date if status=CONTINUED to specific future meeting
  headline: string;
  description?: string | null;
  location?: string | null;
  estimated_value?: number | null;
  project_type?: string | null;
  owner_name?: string | null;
  architect_name?: string | null;
  gc_names?: string[];
  sub_names?: string[];
  relevance_score?: number | null;
  status?: string | null;
};

type SidecarRelationship = {
  from_type: string;
  from_name: string;
  to_type: string;
  to_name: string;
  relationship_type: string;
  project_name?: string | null;
  project_value?: number | null;
  confidence?: string | null;
};

export type ScanSidecarResponse = {
  signals_found: number;
  relationships_found: number;
  jurisdiction: string | null;
  document_date: string | null;
  signals: SidecarSignal[];
  relationships: SidecarRelationship[];
  raw_text: string | null;
  char_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
};

export type ScrapeSidecarResponse = {
  docs_found: number;
  docs_in_range: number;
  docs_scanned: number;
  docs_skipped: number;
  docs_dropped_date: number;
  docs_dropped_undated: number;
  docs_prefilter_applied: number;
  docs_prefilter_skipped: number;
  docs_prefilter_failed: number;
  total_chars_saved: number;
  results: Array<{
    doc_url: string;
    doc_url_full: string;
    title: string | null;
    signals: SidecarSignal[];
    relationships: SidecarRelationship[];
    jurisdiction: string | null;
    document_date: string | null;
    raw_text: string | null;
    char_count: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    prefilter_used: "none" | "applied" | "skipped_empty" | "fallback_direct";
    prefilter_chars_in: number;
    prefilter_chars_out: number;
    error?: string | null;
  }>;
  total_cost_usd: number;
};

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

// Option A (docs/architecture/adr/0001-ai-credential-resolution.md,
// docs/architecture/adr/0002-remaining-sidecar-credential-targets.md): the
// Anthropic credential is resolved ONCE here, TS-side, and forwarded as an
// explicit `api_key` request-body field to the sidecar — the sidecar never
// resolves its own. This one resolution point covers EVERY caller of
// callSidecarScan / callSidecarScrape uniformly: the manual scan/scrape-now
// routes, run-due's runMarketScrape() (unattended worker path), and the
// cron-driven municipalAgendaIngestion runner (which reaches these functions
// through scrapeOneSource). Each of those has TS/Node code with getSetting()
// access executing before the sidecar is ever called, so no path is missed.
// Fails closed (throws) when the key is missing, mirroring the existing
// "sidecar unavailable" throw shape — callers already map thrown errors to a
// 502 / failed-job outcome, so no path proceeds without a credential.
async function resolveAnthropicKey(): Promise<string> {
  const apiKey = await getSetting("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
    );
  }
  return apiKey;
}

export async function callSidecarScan(input: {
  url?: string;
  text?: string;
  jurisdiction?: string;
  sourceDate?: string;
}): Promise<ScanSidecarResponse> {
  const apiKey = await resolveAnthropicKey();
  const res = await fetch(`${SIDECAR_URL}/market/scan-document`, {
    method: "POST",
    headers: sidecarHeaders(),
    body: JSON.stringify({
      url: input.url,
      text: input.text,
      jurisdiction: input.jurisdiction,
      source_date: input.sourceDate,
      api_key: apiKey,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Sidecar scan failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as ScanSidecarResponse;
}

export async function callSidecarScrape(input: {
  sourceId: string;
  url: string;
  jurisdiction: string;
  alreadySeen: string[];
  maxDocs?: number;
  dateFrom?: string;
  dateTo?: string;
  includeUndated?: boolean;
  prefilterMode?: "off" | "large" | "always";
  prefilterThreshold?: number;
  prefilterModel?: string | null;
}): Promise<ScrapeSidecarResponse> {
  const apiKey = await resolveAnthropicKey();
  const res = await fetch(`${SIDECAR_URL}/market/scrape-source`, {
    method: "POST",
    headers: sidecarHeaders(),
    body: JSON.stringify({
      source_id: input.sourceId,
      url: input.url,
      jurisdiction: input.jurisdiction,
      already_seen: input.alreadySeen,
      max_docs: input.maxDocs ?? 5,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      include_undated: input.includeUndated ?? false,
      prefilter_mode: input.prefilterMode ?? "off",
      prefilter_threshold: input.prefilterThreshold ?? 30000,
      prefilter_model: input.prefilterModel ?? null,
      api_key: apiKey,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Sidecar scrape failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as ScrapeSidecarResponse;
}

// ── Persist sidecar payload → MarketSignal / MarketLead / RelationshipEdge ──

const SIGNAL_TYPE_MAP: Record<string, string> = {
  permit:            "PERMIT",
  meeting_minute:    "MEETING_MINUTE",
  plan_room_job:     "PLAN_ROOM_JOB",
  plan_room_view:    "PLAN_ROOM_VIEW",
  land_acquisition:  "LAND_ACQUISITION",
  broker_listing:    "BROKER_LISTING",
  architect_project: "ARCHITECT_PROJECT",
};

const LEAD_TYPE_BY_SIGNAL: Record<string, string> = {
  PERMIT:            "PERMIT",
  MEETING_MINUTE:    "MEETING_MINUTE",
  PLAN_ROOM_JOB:     "PLAN_ROOM",
  PLAN_ROOM_VIEW:    "PLAN_ROOM",
  LAND_ACQUISITION:  "LAND_ACQUISITION",
  BROKER_LISTING:    "BROKER",
  ARCHITECT_PROJECT: "RELATIONSHIP",
};

function normalizeSignalType(raw: string): string {
  const k = (raw || "").toLowerCase();
  return SIGNAL_TYPE_MAP[k] ?? raw?.toUpperCase() ?? "MANUAL";
}

function normalizeConfidence(raw: string | null | undefined): string {
  const v = (raw || "").toUpperCase();
  if (v === "LOW" || v === "MEDIUM" || v === "HIGH") return v;
  return "MEDIUM";
}

const VALID_SUBTYPES = new Set([
  "SUP_CUP", "REZONING", "PLAT", "VARIANCE", "SITE_PLAN",
  "COMPREHENSIVE_PLAN", "ANNEXATION", "TIF", "BOND",
  "PERMIT_AWARD", "CONTRACT_AWARD",
  // O2.2 PR5 — high-emergence infrastructure subtypes.
  "UTILITY_EXPANSION", "CORRIDOR_STUDY", "INFRASTRUCTURE_PLAN", "INDUSTRIAL_REZONING",
  // O2.2 PR6 — governance-emergence subtypes. Mirror the SYSTEM_PROMPT
  // extension in sidecar/routers/market.py. signalHeuristics.ts (v2) has
  // matched boost weights: ZONING_REWRITE +0.35, INFRASTRUCTURE_FUNDING +0.35,
  // DENSITY_EXPANSION/TIF_APPROVAL +0.30, CODE_ADOPTION +0.20,
  // MORATORIUM/ORDINANCE_CHANGE +0.15.
  "CODE_ADOPTION", "ORDINANCE_CHANGE", "ZONING_REWRITE", "DENSITY_EXPANSION",
  "TIF_APPROVAL", "MORATORIUM", "INFRASTRUCTURE_FUNDING",
  "OTHER",
]);
function normalizeSignalSubtype(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).toUpperCase().replace(/[\s-]/g, "_");
  return VALID_SUBTYPES.has(v) ? v : "OTHER";
}

const STATUS_MAP: Record<string, string> = {
  APPROVED: "APPROVED",
  CONTINUED: "CONTINUED",
  TABLED: "CONTINUED",
  DENIED: "DENIED",
  REJECTED: "DENIED",
  DISCUSSED_NO_VOTE: "DISCUSSED_NO_VOTE",
  DISCUSSED: "DISCUSSED_NO_VOTE",
  WITHDRAWN: "WITHDRAWN",
  // backward compat with the older lowercase set
  approved: "APPROVED",
  pending: "DISCUSSED_NO_VOTE",
  awarded: "APPROVED",
  discussed: "DISCUSSED_NO_VOTE",
  rejected: "DENIED",
  under_construction: "APPROVED",
};
function normalizeStatus(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return STATUS_MAP[raw] ?? STATUS_MAP[String(raw).toUpperCase()] ?? "DISCUSSED_NO_VOTE";
}

export type SourceTuning = {
  minRelevanceScore?: number;
  minEstimatedValue?: number | null;
  projectTypeAllowlist?: string | null;   // CSV
};

function parseAllowlist(csv?: string | null): Set<string> | null {
  if (!csv) return null;
  const parts = csv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

export type PersistResult = {
  signalsCreated: number;
  leadsCreated: number;
  relationshipsCreated: number;
  signalsDroppedRelevance: number;
  signalsDroppedProjectType: number;
  leadsDroppedValue: number;
  // O2.2 PR1: row IDs of freshly-created rows, exposed so the scrape bridge
  // (lib/services/marketIntelligence/scrapeOneSource.ts) can hand each one to
  // liveIngestion.processNewMarket{Signal,Lead}/processNewRelationshipEdge.
  // Empty arrays when nothing was created. Order matches insertion order.
  createdSignalIds: string[];
  createdLeadIds: string[];
  createdEdgeIds: string[];
  // O2.2 PR3: signals dropped by the deterministic heuristic classifier
  // (signalHeuristics.ts). These never become MarketSignal rows but are
  // surfaced in the audit summary for explainability. Always SUPPRESSED.
  signalsSuppressedHeuristics: number;
  /** Per-classification persisted count (excludes SUPPRESSED — see
   *  signalsSuppressedHeuristics for that). When skipHeuristics is true,
   *  all classifications are null and this map is empty. */
  classifiedByBand: Partial<Record<SignalClassification, number>>;
};

export async function persistSidecarPayload(args: {
  signals: SidecarSignal[];
  relationships: SidecarRelationship[];
  jurisdiction: string | null;
  documentDate: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
  sourceDocId?: string | null;
  tuning?: SourceTuning;
  // O2.2 PR3: heuristic classifier integration. When `skipHeuristics` is
  // true the classifier is bypassed entirely (debug/operator-override mode).
  // When false (default), each signal is classified; SUPPRESSED signals
  // are dropped before persistence; persisted signals get heuristics columns.
  skipHeuristics?: boolean;
  heuristicsContext?: SignalContext;
  /** Per-doc packet hash (sha256-16). Passed verbatim to classifySignal so
   *  the DUPLICATE_PACKET detector can fire for every signal sharing this doc. */
  docPacketHash?: string | null;
}): Promise<PersistResult> {
  const sourceDate =
    args.documentDate && !Number.isNaN(Date.parse(args.documentDate))
      ? new Date(args.documentDate)
      : null;

  const minRelevance  = args.tuning?.minRelevanceScore ?? 0;
  const minValue      = args.tuning?.minEstimatedValue ?? null;
  const allowedTypes  = parseAllowlist(args.tuning?.projectTypeAllowlist);

  let signalsCreated = 0;
  let leadsCreated = 0;
  let relationshipsCreated = 0;
  let signalsDroppedRelevance = 0;
  let signalsDroppedProjectType = 0;
  let leadsDroppedValue = 0;
  let signalsSuppressedHeuristics = 0;
  const classifiedByBand: Partial<Record<SignalClassification, number>> = {};
  const createdSignalIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdEdgeIds: string[] = [];

  for (const s of args.signals) {
    const relevance = typeof s.relevance_score === "number" ? s.relevance_score : null;
    if (relevance != null && relevance < minRelevance) {
      signalsDroppedRelevance += 1;
      continue;
    }
    if (allowedTypes) {
      const pt = (s.project_type || "").toLowerCase();
      if (pt && !allowedTypes.has(pt)) {
        signalsDroppedProjectType += 1;
        continue;
      }
    }

    const signalType = normalizeSignalType(s.signal_type);
    const subtypeNormalized = normalizeSignalSubtype(s.signal_subtype);

    // ── O2.2 PR3: deterministic heuristic classifier ──────────────────────
    let heuristicResult: HeuristicResult | null = null;
    if (!args.skipHeuristics) {
      heuristicResult = classifySignal({
        headline: s.headline ?? "",
        signalType,
        signalSubtype: subtypeNormalized,
        rawText: s.description ?? null,
        metadata: {
          owner_name: s.owner_name ?? null,
          architect_name: s.architect_name ?? null,
          gc_names: s.gc_names ?? [],
          sub_names: s.sub_names ?? [],
          estimated_value: s.estimated_value ?? null,
          project_type: s.project_type ?? null,
          location: s.location ?? null,
        },
        documentDate: sourceDate,
        jurisdiction: args.jurisdiction,
        docPacketHash: args.docPacketHash ?? null,
        context: args.heuristicsContext,
      });

      if (heuristicResult.shouldDrop) {
        signalsSuppressedHeuristics += 1;
        recordSignalSuppression(heuristicResult.classification);
        continue;
      }

      classifiedByBand[heuristicResult.classification] =
        (classifiedByBand[heuristicResult.classification] ?? 0) + 1;
      recordSignalClassification(heuristicResult.classification);
    }
    // Lead auto-create gates: relevance threshold AND (if minValue set) estimated value
    const meetsLeadRelevance = (relevance ?? 0) >= Math.max(minRelevance, 60);
    const estValue = typeof s.estimated_value === "number" ? s.estimated_value : null;
    const meetsLeadValue = minValue == null || estValue == null || estValue >= minValue;
    const shouldCreateLead = meetsLeadRelevance && meetsLeadValue;
    if (meetsLeadRelevance && !meetsLeadValue) leadsDroppedValue += 1;

    let leadId: string | null = null;
    if (shouldCreateLead) {
      const lead = await prisma.marketLead.create({
        data: {
          title: s.headline?.slice(0, 200) || "Untitled lead",
          leadType: LEAD_TYPE_BY_SIGNAL[signalType] ?? "MANUAL",
          source: args.sourceLabel,
          sourceUrl: args.sourceUrl,
          sourceDocId: args.sourceDocId ?? null,
          aiScore: relevance,
          confidence: relevance != null && relevance >= 80 ? "HIGH" : relevance != null && relevance >= 50 ? "MEDIUM" : "LOW",
          location: s.location || null,
          jurisdiction: args.jurisdiction || null,
          projectType: s.project_type || null,
          estimatedValue: estValue,
          rawText: s.description || null,
          aiSummary: s.description || null,
          aiInsights: JSON.stringify({
            owner: s.owner_name ?? null,
            architect: s.architect_name ?? null,
            gcs: s.gc_names ?? [],
            subs: s.sub_names ?? [],
            status: s.status ?? null,
          }),
          detectedAt: sourceDate ?? new Date(),
        },
      });
      leadId = lead.id;
      leadsCreated += 1;
      createdLeadIds.push(lead.id);
    }

    // Normalize Phase 5K fields: subtype (uppercase, valid enum) + next-meeting date
    const nextMtg = s.next_meeting_date && !Number.isNaN(Date.parse(s.next_meeting_date))
      ? new Date(s.next_meeting_date)
      : null;
    const statusNormalized = normalizeStatus(s.status);

    const created = await prisma.marketSignal.create({
      data: {
        leadId,
        sourceDocId: args.sourceDocId ?? null,
        signalType,
        signalSubtype: subtypeNormalized,
        source: args.sourceLabel,
        sourceUrl: args.sourceUrl,
        sourceDate,
        headline: s.headline?.slice(0, 200) || "(no headline)",
        rawText: s.description || null,
        metadata: JSON.stringify({
          location: s.location ?? null,
          estimated_value: s.estimated_value ?? null,
          project_type: s.project_type ?? null,
          owner_name: s.owner_name ?? null,
          architect_name: s.architect_name ?? null,
          gc_names: s.gc_names ?? [],
          sub_names: s.sub_names ?? [],
          status: statusNormalized,
        }),
        aiRelevanceScore: relevance,
        nextMeetingDate: nextMtg,
        // O2.2 PR3: persist the heuristic verdict alongside the row.
        heuristicsJson:           heuristicResult ? JSON.stringify(heuristicResult.factors) : null,
        heuristicsVersion:        heuristicResult?.heuristicsVersion ?? null,
        heuristicsScore:          heuristicResult?.score ?? null,
        heuristicsClassification: heuristicResult?.classification ?? null,
      },
    });
    signalsCreated += 1;
    createdSignalIds.push(created.id);
  }

  for (const r of args.relationships) {
    const edge = await prisma.relationshipEdge.create({
      data: {
        fromType: r.from_type?.toUpperCase() || "GC",
        fromName: r.from_name?.trim() || "Unknown",
        toType: r.to_type?.toUpperCase() || "GC",
        toName: r.to_name?.trim() || "Unknown",
        relationshipType: r.relationship_type?.toUpperCase() || "PARTNERED",
        projectName: r.project_name || null,
        projectValue: typeof r.project_value === "number" ? r.project_value : null,
        location: args.jurisdiction || null,
        source: args.sourceLabel,
        sourceUrl: args.sourceUrl,
        confidence: normalizeConfidence(r.confidence),
      },
    });
    relationshipsCreated += 1;
    createdEdgeIds.push(edge.id);
  }

  return {
    signalsCreated,
    leadsCreated,
    relationshipsCreated,
    signalsDroppedRelevance,
    signalsDroppedProjectType,
    leadsDroppedValue,
    createdSignalIds,
    createdLeadIds,
    createdEdgeIds,
    signalsSuppressedHeuristics,
    classifiedByBand,
  };
}
