// Module OPS3 (Phase 1A) — observations collection for one report.
//
// GET  …/[reportId]/observations       list (with live linked-item status)
// POST …/[reportId]/observations       manual create (ENTERED) — a human typed
//                                      this while reading the PDF; nothing is
//                                      ever extracted automatically.
//
// consultantTargetDate is source-verbatim: stored here, displayed beside
// TrackedItem.dueDate, NEVER synced into it in either direction.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { createObservation } from "@/lib/services/consultantReports/observations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const report = await prisma.consultantReport.findFirst({
    where: { id: rid, bidId },
    select: { id: true },
  });
  if (!report) return Response.json({ error: "Not found" }, { status: 404 });

  const observations = await prisma.consultantObservation.findMany({
    where: { reportId: rid, bidId },
    orderBy: { createdAt: "asc" },
    include: {
      registerItem: {
        select: { id: true, title: true, status: true, dueDate: true },
      },
    },
  });
  return Response.json({ observations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: {
    observationText?: unknown;
    sourcePage?: unknown;
    consultantTargetDate?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.observationText !== "string") {
    return Response.json({ error: "observationText is required" }, { status: 400 });
  }
  let consultantTargetDate: Date | null = null;
  if (body.consultantTargetDate != null) {
    if (typeof body.consultantTargetDate !== "string") {
      return Response.json({ error: "Invalid consultantTargetDate" }, { status: 400 });
    }
    consultantTargetDate = new Date(body.consultantTargetDate);
    if (isNaN(consultantTargetDate.getTime())) {
      return Response.json({ error: "Invalid consultantTargetDate" }, { status: 400 });
    }
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await createObservation(
    bidId,
    rid,
    {
      observationText: body.observationText,
      sourcePage: typeof body.sourcePage === "string" ? body.sourcePage : null,
      consultantTargetDate,
    },
    { name: user?.name ?? null, email: user?.email ?? null }
  );
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, id: result.value.id }, { status: 201 });
}
