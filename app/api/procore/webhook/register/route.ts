// GET  /api/procore/webhook/register — check current registration status
// POST /api/procore/webhook/register — register webhook with Procore
// DELETE /api/procore/webhook/register — unregister a hook by hookId
//
// Tier F F3 — Webhook registration management.
//
// Procore webhooks require a public HTTPS URL. Set PROCORE_WEBHOOK_URL in
// Settings → Procore Integration before registering. The URL must be the full
// path to this app's /api/procore/webhook endpoint.
//
// Registration POSTs to Procore's /rest/v1.0/webhooks/hooks with triggers for:
//   - rfis.create / rfis.update
//   - submittals.update
//
// The returned hook ID is what you pass to DELETE to unregister.

import { procoreGet, procorePost, procoreDelete, getCompanyId, ProcoreError } from "@/lib/services/procore/client";
import { getSetting } from "@/lib/services/settings/appSettingsService";

type ProcoreHook = {
  id: number;
  api_url: string;
  namespace: string;
  status?: string;
};

type HookListResponse = {
  hooks?: ProcoreHook[];
} | ProcoreHook[];

// ── GET — check registration status ────────────────────────────────────────

export async function GET() {
  try {
    const companyId = await getCompanyId();
    const webhookUrl = await getSetting("PROCORE_WEBHOOK_URL");

    const raw = await procoreGet<HookListResponse>(
      `/rest/v1.0/webhooks/hooks?filters[company_id]=${companyId}`
    );

    const hooks: ProcoreHook[] = Array.isArray(raw) ? raw : (raw.hooks ?? []);
    const ourHook = webhookUrl
      ? hooks.find((h) => h.api_url === webhookUrl)
      : null;

    return Response.json({
      registered: !!ourHook,
      hookId: ourHook?.id ?? null,
      hookUrl: ourHook?.api_url ?? null,
      totalHooks: hooks.length,
    });
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

// ── POST — register webhook ─────────────────────────────────────────────────

export async function POST() {
  const [companyId, webhookUrl, webhookSecret] = await Promise.all([
    getCompanyId().catch(() => null),
    getSetting("PROCORE_WEBHOOK_URL"),
    getSetting("PROCORE_WEBHOOK_SECRET"),
  ]);

  if (!companyId) {
    return Response.json(
      { error: "Procore credentials not configured. Go to Settings → Procore Integration." },
      { status: 400 }
    );
  }
  if (!webhookUrl) {
    return Response.json(
      { error: "Webhook URL not set. Add it in Settings → Procore Integration." },
      { status: 400 }
    );
  }
  if (!webhookSecret) {
    return Response.json(
      { error: "Webhook Secret not set. Add it in Settings → Procore Integration." },
      { status: 400 }
    );
  }

  try {
    const result = await procorePost<{ hook: ProcoreHook }>(
      `/rest/v1.0/webhooks/hooks`,
      {
        hook: {
          api_url: webhookUrl,
          namespace: "procore.webhooks.v1",
          company_id: parseInt(companyId, 10),
          api_key: webhookSecret,
          triggers: [
            { source_type: "rfis", source_id: null, event_type: "create" },
            { source_type: "rfis", source_id: null, event_type: "update" },
            { source_type: "submittals", source_id: null, event_type: "update" },
          ],
        },
      }
    );

    return Response.json({
      ok: true,
      hookId: result.hook.id,
      hookUrl: webhookUrl,
    });
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

// ── DELETE — unregister webhook ─────────────────────────────────────────────

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { hookId?: number };
  if (!body.hookId) {
    return Response.json({ error: "hookId is required" }, { status: 400 });
  }

  try {
    await procoreDelete(`/rest/v1.0/webhooks/hooks/${body.hookId}`);
    return Response.json({ ok: true });
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
