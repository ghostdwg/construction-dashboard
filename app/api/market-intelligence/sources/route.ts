import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["city_council", "planning_commission", "permit_feed", "rss", "energov"];
const VALID_PREFILTER_MODES = ["off", "large", "always"];
// O2.2 PR3: operator can reset a STALE_PUBLISH or OPERATOR_REVIEW source back
// to HEALTHY via PATCH. Automation never sets HEALTHY → OPERATOR_REVIEW; only
// operators do.
const VALID_PUBLISH_STATUSES = ["HEALTHY", "STALE_PUBLISH", "OPERATOR_REVIEW"];

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseInt100(v: unknown, def: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.min(100, n));
}

function parseFloatOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseAllowlist(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function GET() {
  const sources = await prisma.marketSource.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      docs: {
        select: { id: true, scannedAt: true, signalsFound: true, documentDate: true, title: true },
        orderBy: { scannedAt: "desc" },
        take: 5,
      },
      _count: { select: { docs: true } },
    },
  });
  return Response.json({ sources });
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    name,
    jurisdiction,
    url,
    sourceType,
    dateFrom,
    dateTo,
    minRelevanceScore,
    minEstimatedValue,
    projectTypeAllowlist,
    prefilterMode,
    prefilterCharThreshold,
    prefilterModel,
  } = body;

  if (!name?.trim() || !jurisdiction?.trim() || !url?.trim()) {
    return Response.json(
      { error: "name, jurisdiction, and url are required" },
      { status: 400 },
    );
  }
  if (sourceType && !VALID_TYPES.includes(sourceType)) {
    return Response.json(
      { error: `sourceType must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    new URL(url);
  } catch {
    return Response.json({ error: "url must be a valid URL" }, { status: 400 });
  }

  const dFrom = parseDate(dateFrom);
  const dTo   = parseDate(dateTo);
  if (dFrom === undefined && dateFrom !== undefined) {
    return Response.json({ error: "dateFrom is not a valid date" }, { status: 400 });
  }
  if (dTo === undefined && dateTo !== undefined) {
    return Response.json({ error: "dateTo is not a valid date" }, { status: 400 });
  }

  const pfMode = prefilterMode && VALID_PREFILTER_MODES.includes(prefilterMode) ? prefilterMode : "off";
  const pfThreshold = (() => {
    if (prefilterCharThreshold === undefined || prefilterCharThreshold === null || prefilterCharThreshold === "") return 30000;
    const n = Math.trunc(Number(prefilterCharThreshold));
    return Number.isFinite(n) && n > 0 ? n : 30000;
  })();

  const source = await prisma.marketSource.create({
    data: {
      name: name.trim(),
      jurisdiction: jurisdiction.trim(),
      url: url.trim(),
      sourceType: sourceType || "city_council",
      dateFrom: dFrom ?? null,
      dateTo:   dTo   ?? null,
      minRelevanceScore: parseInt100(minRelevanceScore, 60),
      minEstimatedValue: parseFloatOrNull(minEstimatedValue) ?? null,
      projectTypeAllowlist: parseAllowlist(projectTypeAllowlist) ?? null,
      prefilterMode: pfMode,
      prefilterCharThreshold: pfThreshold,
      prefilterModel: typeof prefilterModel === "string" && prefilterModel.trim() ? prefilterModel.trim() : null,
    },
  });

  return Response.json(source, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { id } = body;
  if (!id || typeof id !== "string") {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined)         data.name = String(body.name).trim();
  if (body.jurisdiction !== undefined) data.jurisdiction = String(body.jurisdiction).trim();
  if (body.url !== undefined)          data.url = String(body.url).trim();
  if (body.isActive !== undefined)     data.isActive = Boolean(body.isActive);
  if (body.sourceType !== undefined) {
    if (!VALID_TYPES.includes(body.sourceType)) {
      return Response.json({ error: `sourceType must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
    }
    data.sourceType = body.sourceType;
  }
  const dFrom = parseDate(body.dateFrom);
  if (dFrom !== undefined) data.dateFrom = dFrom;
  const dTo = parseDate(body.dateTo);
  if (dTo !== undefined) data.dateTo = dTo;
  if (body.minRelevanceScore !== undefined) data.minRelevanceScore = parseInt100(body.minRelevanceScore, 60);
  const mv = parseFloatOrNull(body.minEstimatedValue);
  if (mv !== undefined) data.minEstimatedValue = mv;
  const al = parseAllowlist(body.projectTypeAllowlist);
  if (al !== undefined) data.projectTypeAllowlist = al;
  if (body.prefilterMode !== undefined) {
    if (!VALID_PREFILTER_MODES.includes(body.prefilterMode)) {
      return Response.json({ error: `prefilterMode must be one of: ${VALID_PREFILTER_MODES.join(", ")}` }, { status: 400 });
    }
    data.prefilterMode = body.prefilterMode;
  }
  if (body.prefilterCharThreshold !== undefined) {
    const n = Math.trunc(Number(body.prefilterCharThreshold));
    if (Number.isFinite(n) && n > 0) data.prefilterCharThreshold = n;
  }
  if (body.prefilterModel !== undefined) {
    data.prefilterModel = typeof body.prefilterModel === "string" && body.prefilterModel.trim()
      ? body.prefilterModel.trim() : null;
  }
  // O2.2 PR3: allow operator reset of publishStatus + consecutiveEmptyRuns.
  if (body.publishStatus !== undefined) {
    if (!VALID_PUBLISH_STATUSES.includes(body.publishStatus)) {
      return Response.json({ error: `publishStatus must be one of: ${VALID_PUBLISH_STATUSES.join(", ")}` }, { status: 400 });
    }
    data.publishStatus = body.publishStatus;
    // Resetting to HEALTHY clears the empty-run counter — the source gets
    // a fresh shot at proving itself before re-triggering dormancy detection.
    if (body.publishStatus === "HEALTHY") {
      data.consecutiveEmptyRuns = 0;
      data.lastEmptyRunAt = null;
    }
  }

  try {
    const updated = await prisma.marketSource.update({ where: { id }, data });
    return Response.json(updated);
  } catch {
    return Response.json({ error: "Source not found" }, { status: 404 });
  }
}
