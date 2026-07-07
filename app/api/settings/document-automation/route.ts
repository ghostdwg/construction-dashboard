// GET   /api/settings/document-automation
// PATCH /api/settings/document-automation   body: { enabled: boolean }
//
// Q03.2b — Admin-only control for the GLOBAL "Document AI Enrichment"
// setting (persisted AppSetting row, default OFF). Deliberately a dedicated
// route rather than a SETTING_DEFINITIONS entry: the generic /api/settings/app
// path carries an env-var fallback, which is exactly the hidden side-door
// this control removes. Both verbs are admin-gated — the effective state,
// last-change actor, and the emergency-lock status are privileged control
// data, not user-visible data.
//
// Every change is audited (category "operator_override" — DB-persisted per
// lib/observability/taxonomy.ts) with actor, old/new state, timestamp, and
// global scope.

import { auth, isAdminAuthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import { clearAppSettingsCache } from "@/lib/services/settings/appSettingsService";
import {
  DOCUMENT_AUTOMATION_SETTING_KEY,
  getDocumentAutomationState,
} from "@/lib/services/settings/documentAutomation";

const AUDIT_ACTION = "document_automation_toggle";

async function stateWithLastChange() {
  const state = await getDocumentAutomationState();
  const last = await prisma.auditEvent.findFirst({
    where: { action: AUDIT_ACTION },
    orderBy: { emittedAt: "desc" },
    select: { actorEmail: true, emittedAt: true, decision: true },
  });
  return {
    ...state,
    lastChange: last
      ? {
          actorEmail: last.actorEmail,
          at: last.emittedAt.toISOString(),
          decision: last.decision,
        }
      : null,
  };
}

export async function GET() {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }
  try {
    return Response.json(await stateWithLastChange());
  } catch (err) {
    console.error("[GET /api/settings/document-automation]", err);
    return Response.json({ error: "Failed to load document-automation state" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const enabled = body.enabled;

  try {
    const before = await getDocumentAutomationState();

    await prisma.appSetting.upsert({
      where: { key: DOCUMENT_AUTOMATION_SETTING_KEY },
      create: { key: DOCUMENT_AUTOMATION_SETTING_KEY, value: enabled ? "true" : "false" },
      update: { value: enabled ? "true" : "false" },
    });
    // Keep the generic settings cache coherent (the gate itself never reads
    // that cache — it reads the DB fresh per document event).
    clearAppSettingsCache();

    const session = await auth();
    const user = session?.user as { id?: string; email?: string | null } | undefined;

    await emitAuditEvent({
      category: "operator_override",
      action: AUDIT_ACTION,
      severity: "NOTICE",
      decision: enabled ? "enabled" : "disabled",
      subject: { kind: "AppSetting", id: DOCUMENT_AUTOMATION_SETTING_KEY },
      actor: {
        kind: "operator",
        userId: user?.id ?? null,
        email: user?.email ?? null,
      },
      payload: {
        scope: "global",
        from: before.adminEnabled,
        to: enabled,
        hardDisabledAtChange: before.hardDisabled,
      },
    });

    return Response.json(await stateWithLastChange());
  } catch (err) {
    console.error("[PATCH /api/settings/document-automation]", err);
    return Response.json({ error: "Failed to update document-automation setting" }, { status: 500 });
  }
}
