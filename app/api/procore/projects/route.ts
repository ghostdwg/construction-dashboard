// GET /api/procore/projects?q={search}
//
// Tier F F2 — Procore project search
//
// Returns matching Procore projects for the configured company.
// Used by ProcoreTab to let the user select/link a project.
//
// Response: { projects: ProcoreProjectItem[] }

import { getProcoreCreds, procoreGet, ProcoreError } from "@/lib/services/procore/client";

type ProcoreProject = { id: number; name: string; project_number?: string; status?: string };
type ProcoreProjectItem = { id: number; name: string; projectNumber: string | null; status: string | null };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  try {
    const creds = await getProcoreCreds();

    const url = q
      ? `/rest/v1.0/companies/${creds.companyId}/projects?filters[name]=${encodeURIComponent(q)}&per_page=50`
      : `/rest/v1.0/companies/${creds.companyId}/projects?per_page=50`;

    const projects = await procoreGet<ProcoreProject[]>(url);

    const items: ProcoreProjectItem[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      projectNumber: p.project_number ?? null,
      status: p.status ?? null,
    }));

    return Response.json({ projects: items });
  } catch (err) {
    const message =
      err instanceof ProcoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
