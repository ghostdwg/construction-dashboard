// Q03.2b — Admin-controlled document AI enrichment (GLOBAL system setting).
//
// Product decision: automatic document-event AI enrichment (the fire-and-
// forget generateBidIntelligence / triggerBriefRefresh calls on spec-book
// upload, drawings upload, and addendum delete) is controlled from the
// authenticated Admin panel, persisted in the existing AppSetting model —
// NOT by a deploy-time env flag. Default state: OFF (no row = OFF).
//
// SAFETY HIERARCHY (highest first):
//   1. Storage-smoke suppression (the routes check it BEFORE consulting this
//      module) — preserves "suppressed_for_storage_smoke" untouched.
//   2. DOCUMENT_AUTOMATION_HARD_DISABLED — optional EMERGENCY PLATFORM
//      SAFETY LOCK. Exact-literal semantics: ONLY the string "true" engages
//      it, and it can only FORCE AUTOMATION OFF (it can never enable
//      anything). Absent, "false", "TRUE", "1", or any other value = lock
//      not engaged — automation is then decided solely by the Admin setting.
//   3. The persisted Admin setting below — the ONLY thing that can ENABLE
//      automation. The legacy DOCUMENT_AUTOMATION_ENABLED env var is read
//      NOWHERE anymore and can never enable automation (no hidden side-door).
//
// Freshness: state is read straight from the DB on every call — deliberately
// NOT the cached getSetting() path, because (a) an Admin toggle must take
// effect on the very NEXT document action with no restart/redeploy and no
// long-lived cache, and (b) getSetting()'s env-var fallback is exactly the
// side-door this control removes. One indexed single-row read per document
// event is the accepted cost of that guarantee.

import { prisma } from "@/lib/prisma";

export const DOCUMENT_AUTOMATION_SETTING_KEY = "documentAutomationEnabled";

export type DocumentAutomationStatus = "triggered" | "disabled" | "hard_disabled";

export function isDocumentAutomationHardDisabled(): boolean {
  return process.env.DOCUMENT_AUTOMATION_HARD_DISABLED === "true";
}

export interface DocumentAutomationState {
  /** The persisted Admin setting (row value === "true"; no row / anything else = false). */
  adminEnabled: boolean;
  /** The emergency platform safety lock (exact literal "true" only). */
  hardDisabled: boolean;
  /** What document events actually do: adminEnabled AND NOT hardDisabled. */
  effectiveEnabled: boolean;
  /** AppSetting.updatedAt of the persisted row, if one exists. */
  updatedAt: string | null;
}

export async function getDocumentAutomationState(): Promise<DocumentAutomationState> {
  const row = await prisma.appSetting.findUnique({
    where: { key: DOCUMENT_AUTOMATION_SETTING_KEY },
  });
  const adminEnabled = row?.value === "true";
  const hardDisabled = isDocumentAutomationHardDisabled();
  return {
    adminEnabled,
    hardDisabled,
    effectiveEnabled: adminEnabled && !hardDisabled,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/**
 * The status a document-event route reports (and acts on) when storage-smoke
 * suppression does NOT apply: "triggered" fires today's automation path;
 * "disabled" (Admin setting off — the default) and "hard_disabled"
 * (emergency lock engaged) both mean NO provider-bound call is made and the
 * response says so honestly.
 *
 * FAIL-CLOSED on lookup failure: if the persisted-setting read rejects
 * (DB unavailable, etc.), provider-bound automation must never fire — the
 * event is treated as "disabled" (honest: automation is off for this event)
 * and the document action itself still succeeds. The hard-disable lock is
 * still honored (it is a pure env read, independent of the DB). Admin-panel
 * reads deliberately do NOT get this catch — getDocumentAutomationState()
 * still rejects there so operators see the real error, not a fabricated
 * "off" state.
 */
export async function documentAutomationStatus(): Promise<DocumentAutomationStatus> {
  if (isDocumentAutomationHardDisabled()) return "hard_disabled";
  try {
    const state = await getDocumentAutomationState();
    return state.adminEnabled ? "triggered" : "disabled";
  } catch (err) {
    console.error(
      "[documentAutomation] settings lookup failed — failing closed (automation disabled for this event):",
      err instanceof Error ? err.message : err
    );
    return "disabled";
  }
}
