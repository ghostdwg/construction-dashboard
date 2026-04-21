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
