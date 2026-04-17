// GET /api/procore/test
//
// Tier F F2 — Procore credential test
//
// Attempts to fetch company info using the configured client credentials.
// Returns { ok: true, companyName } on success or { ok: false, error } on failure.
// Used by ProcoreSettingsCard to verify credentials before a push.

import { getProcoreCreds, procoreGet, ProcoreError, clearProcoreTokenCache } from "@/lib/services/procore/client";

type ProcoreCompany = { id: number; name: string };

export async function GET() {
  // Clear cached token so we get a fresh auth check
  clearProcoreTokenCache();

  try {
    const creds = await getProcoreCreds();

    // Fetch company info to verify credentials work
    const companies = await procoreGet<ProcoreCompany[]>(
      `/rest/v1.0/companies/${creds.companyId}`
    ).catch(() =>
      // Fallback: some Procore setups return a single object, not an array
      procoreGet<ProcoreCompany>(`/rest/v1.0/companies/${creds.companyId}`)
    );

    const company = Array.isArray(companies) ? companies[0] : companies;

    return Response.json({ ok: true, companyName: company?.name ?? "Connected" });
  } catch (err) {
    const message =
      err instanceof ProcoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return Response.json({ ok: false, error: message });
  }
}
