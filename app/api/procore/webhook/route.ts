// POST /api/procore/webhook
//
// Tier F F3 — Procore webhook event receiver.
//
// Procore calls this URL when a subscribed event fires (RFI created/updated,
// submittal status changed). The handler:
//   1. Verifies the api_key header against PROCORE_WEBHOOK_SECRET (if set).
//   2. Stores the raw payload in ProcoreWebhookEvent.
//   3. Marks the event processed immediately (manual pull buttons handle sync).
//
// This endpoint must return 2xx quickly — Procore retries on timeout.
// Heavy work (re-pulling data) is done by the manual pull routes.

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import { processWebhookEvent } from "@/lib/services/procore/syncService";

// Procore webhook payload shape (subset of what Procore sends)
type ProcoreWebhookPayload = {
  event_type?: string;
  resource_name?: string;
  resource_id?: number;
  project_id?: number;
  company_id?: number;
};

export async function POST(request: Request) {
  const payload = await request.text();

  // Verify the secret key if configured
  const configuredSecret = await getSetting("PROCORE_WEBHOOK_SECRET");
  if (configuredSecret) {
    const incomingKey = request.headers.get("Procore-Api-Key");
    if (incomingKey !== configuredSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let parsed: ProcoreWebhookPayload;
  try {
    parsed = JSON.parse(payload) as ProcoreWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = await prisma.procoreWebhookEvent.create({
    data: {
      eventType: parsed.event_type ?? "unknown",
      resourceType: parsed.resource_name ?? "unknown",
      resourceId: parsed.resource_id ?? null,
      projectId: parsed.project_id ?? null,
      companyId: parsed.company_id ?? null,
      payload,
    },
  });

  // Fire-and-forget — marks the event processed; returns before completion
  processWebhookEvent(event.id).catch(() => {});

  return Response.json({ ok: true, eventId: event.id });
}
