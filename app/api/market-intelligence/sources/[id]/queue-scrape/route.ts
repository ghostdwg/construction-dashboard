import { prisma } from "@/lib/prisma";

// Default off-peak window: next 2am local (server TZ).
// Pass an explicit `runAfter` in the request body to override.
function nextOffPeak(): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(2, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

type Body = {
  runAfter?: string;        // ISO datetime
  dateFrom?: string;
  dateTo?: string;
  maxDocs?: number;
  includeUndated?: boolean;
  prefilterMode?: "off" | "large" | "always";
  prefilterModel?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = await prisma.marketSource.findUnique({ where: { id } });
  if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
  if (!source.isActive) return Response.json({ error: "Source is inactive" }, { status: 400 });

  let body: Body = {};
  try {
    if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 0) {
      body = (await request.json()) as Body;
    }
  } catch { /* ignore */ }

  const runAfter = body.runAfter ? new Date(body.runAfter) : nextOffPeak();
  if (isNaN(runAfter.getTime())) {
    return Response.json({ error: "runAfter is not a valid ISO datetime" }, { status: 400 });
  }

  // Persist scrape override params in inputSummary as JSON
  const overrideParams = {
    dateFrom:       body.dateFrom ?? null,
    dateTo:         body.dateTo ?? null,
    maxDocs:        body.maxDocs ?? null,
    includeUndated: body.includeUndated ?? null,
    prefilterMode:  body.prefilterMode ?? null,
    prefilterModel: body.prefilterModel ?? null,
  };

  // Use Prisma upsert pattern via try/catch on unique constraint: only one active
  // queued job per (sourceId, market_scrape). If one exists, refresh its runAfter.
  type MaybeRunAfter = { runAfter?: Date | null };
  const data: Parameters<typeof prisma.backgroundJob.create>[0]["data"] = {
    jobType: "market_scrape",
    status: "queued",
    relatedId: source.id,
    inputSummary: JSON.stringify(overrideParams),
    triggerSource: "user",
    ...({ runAfter } as MaybeRunAfter),
  };

  try {
    const job = await prisma.backgroundJob.create({ data });
    return Response.json({
      jobId: job.id,
      source: { id: source.id, name: source.name },
      runAfter: runAfter.toISOString(),
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Likely activeSlot unique conflict (already queued/running for this source)
    if (message.includes("Unique") || message.includes("UNIQUE")) {
      return Response.json({ error: "A scrape is already queued or running for this source" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
