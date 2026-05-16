// GET /api/jobs/[id]
//
// GWX-003 — Query a BackgroundJob record from the database.
//
// This is the restart-safe status endpoint. Unlike the sidecar's in-memory
// polling route, this reads from the DB and survives process restarts on
// both the app and sidecar sides.
//
// Response includes the full job record. The client can combine this with
// the sidecar polling route for live progress during active jobs.

import { getJob } from "@/lib/services/jobs/backgroundJobService";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const job = await getJob(id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json({ job });
}

// DELETE — cancel a queued job. Refuses to touch a job that's already running
// or terminal (complete/failed/cancelled) to avoid corrupting in-flight work.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const job = await getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "queued") {
    return Response.json(
      { error: `Cannot cancel a job in '${job.status}' state` },
      { status: 409 }
    );
  }

  const updated = await prisma.backgroundJob.update({
    where: { id },
    data: {
      status: "cancelled",
      completedAt: new Date(),
      errorMessage: "Cancelled via DELETE /api/jobs/[id]",
      activeSlot: null,
    },
  });
  return Response.json({ job: updated });
}

// PATCH — edit a queued job's override params (maxDocs, dateFrom/To, prefilter*)
// and/or its scheduled runAfter time. Refuses to edit non-queued jobs.
type EditBody = {
  runAfter?: string;
  maxDocs?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  includeUndated?: boolean;
  prefilterMode?: "off" | "large" | "always";
  prefilterModel?: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const job = await getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "queued") {
    return Response.json(
      { error: `Cannot edit a job in '${job.status}' state` },
      { status: 409 }
    );
  }

  let body: EditBody = {};
  try { body = (await request.json()) as EditBody; } catch { /* empty */ }

  type Params = Record<string, unknown>;
  const merged: Params = job.inputSummary ? (JSON.parse(job.inputSummary) as Params) : {};
  if ("maxDocs" in body) merged.maxDocs = body.maxDocs;
  if ("dateFrom" in body) merged.dateFrom = body.dateFrom;
  if ("dateTo" in body) merged.dateTo = body.dateTo;
  if ("includeUndated" in body) merged.includeUndated = body.includeUndated;
  if ("prefilterMode" in body) merged.prefilterMode = body.prefilterMode;
  if ("prefilterModel" in body) merged.prefilterModel = body.prefilterModel;

  let runAfter: Date | undefined;
  if (body.runAfter) {
    const d = new Date(body.runAfter);
    if (isNaN(d.getTime())) {
      return Response.json({ error: "runAfter is not a valid ISO datetime" }, { status: 400 });
    }
    runAfter = d;
  }

  const data: { inputSummary: string; runAfter?: Date } = {
    inputSummary: JSON.stringify(merged),
  };
  if (runAfter) data.runAfter = runAfter;

  const updated = await prisma.backgroundJob.update({ where: { id }, data });
  return Response.json({ job: updated });
}
