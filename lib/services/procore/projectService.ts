// Procore project find-or-create service.
//
// Never exposes sub names, pricingData, rawPriceText, or isPreferred.

import { prisma } from "@/lib/prisma";
import { procoreGet, procorePost, getCompanyId, ProcoreError } from "./client";

type ProcoreProject = {
  id: number;
  name: string;
  project_number?: string | null;
  status?: string | null;
};

export type CreateProjectResult =
  | { state: "already_linked"; procoreProjectId: string }
  | { state: "linked_existing"; procoreProjectId: string }
  | { state: "created"; procoreProjectId: string };

export async function createProcoreProject(bidId: number): Promise<CreateProjectResult> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      procoreProjectId: true,
      projectName: true,
      location: true,
      constructionStartDate: true,
    },
  });

  if (!bid) throw new ProcoreError("Bid not found", 404);

  if (bid.procoreProjectId) {
    return { state: "already_linked", procoreProjectId: bid.procoreProjectId };
  }

  const companyId = await getCompanyId();
  const name = bid.projectName;

  // Exact-name search before creating to avoid duplicates
  const existing = await procoreGet<ProcoreProject[]>(
    `/rest/v1.0/companies/${companyId}/projects?filters[name]=${encodeURIComponent(name)}&per_page=50`
  );

  const found = existing.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );

  if (found) {
    const procoreProjectId = String(found.id);
    await prisma.bid.update({
      where: { id: bidId },
      data: { procoreProjectId },
    });
    return { state: "linked_existing", procoreProjectId };
  }

  // Create new project
  const payload: Record<string, unknown> = {
    project: {
      name,
      company_id: Number(companyId),
      project_number: `GWX-${bidId}`,
      ...(bid.location ? { address: bid.location } : {}),
      ...(bid.constructionStartDate
        ? { start_date: bid.constructionStartDate.toISOString().slice(0, 10) }
        : {}),
    },
  };

  const created = await procorePost<ProcoreProject>(
    `/rest/v1.0/companies/${companyId}/projects`,
    payload
  );

  const procoreProjectId = String(created.id);

  // Persist ID immediately — before any further await — to survive crash-window
  await prisma.bid.update({
    where: { id: bidId },
    data: { procoreProjectId },
  });

  return { state: "created", procoreProjectId };
}
