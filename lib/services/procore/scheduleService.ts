// Tier F F4 — Procore schedule push
//
// Builds MSP XML 2007 from the bid's ScheduleV2 and posts it to Procore's
// schedule import endpoint. Procore processes the import asynchronously and
// returns an import record with a job ID and initial status.
//
// Endpoint: POST /rest/v1.0/projects/{project_id}/schedule/imports
// Format accepted: application/xml (MSP 2007 XML)
//
// Response: { ok: true, importId, status, activityCount, scheduleName }

import { buildMspXml } from "@/lib/services/schedule/mspXmlExport";
import { procorePostFormData } from "./client";

// ── Procore API response shape ────────────────────────────────────────────────

type ProcoreImportResponse = {
  id?: number;
  status?: string;
  errors?: string[];
  message?: string;
};

// ── Public result type ────────────────────────────────────────────────────────

export type SchedulePushResult = {
  ok: true;
  importId: number | null;
  status: string | null;
  activityCount: number;
  scheduleName: string;
  procoreErrors: string[];
};

// ── Push function ─────────────────────────────────────────────────────────────

export async function pushScheduleToProcore(
  bidId: number,
  procoreProjectId: string
): Promise<SchedulePushResult> {
  const { xml, scheduleName, activityCount } = await buildMspXml(bidId);

  const formData = new FormData();
  const blob = new Blob([xml], { type: "application/xml" });
  formData.append("schedule[file]", blob, "schedule.xml");

  const importData = await procorePostFormData<ProcoreImportResponse>(
    `/rest/v1.0/projects/${procoreProjectId}/schedule/imports`,
    formData
  );

  return {
    ok: true,
    importId: importData.id ?? null,
    status: importData.status ?? null,
    activityCount,
    scheduleName,
    procoreErrors: importData.errors ?? [],
  };
}
