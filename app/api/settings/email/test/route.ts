// POST /api/settings/email/test
//
// Module SET1 — Email connection test.
//
// Verifies the configured Resend API key is valid by hitting Resend's
// /api-keys list endpoint (cheap, idempotent, doesn't send mail). Optionally
// accepts a `to` address in the body to send a real test email.
//
// Body (optional): { to?: string }
//
// Response:
//   { ok: true, mode: "validate" }                       — key valid, no email sent
//   { ok: true, mode: "send", messageId: "abc-123" }     — test email sent
//   { ok: false, error: "..." }                          — key missing/invalid

import { Resend } from "resend";
import { getSetting } from "@/lib/services/settings/appSettingsService";

export async function POST(request: Request) {
  let body: { to?: string };
  try {
    body = (await request.json().catch(() => ({}))) as { to?: string };
  } catch {
    body = {};
  }

  const apiKey = await getSetting("RESEND_API_KEY");
  const fromEmail = await getSetting("RESEND_FROM_EMAIL");

  if (!apiKey) {
    return Response.json(
      { ok: false, error: "RESEND_API_KEY is not configured" },
      { status: 400 }
    );
  }

  const client = new Resend(apiKey);

  // Mode 1: validate-only (no `to` provided) — list API keys to verify auth
  if (!body.to) {
    try {
      // Resend SDK exposes api_keys.list() — cheap auth check.
      const result = await client.apiKeys.list();
      if (result.error) {
        return Response.json(
          { ok: false, error: result.error.message ?? "Resend rejected the API key" },
          { status: 400 }
        );
      }
      return Response.json({ ok: true, mode: "validate" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: message }, { status: 400 });
    }
  }

  // Mode 2: send a real test email
  if (!fromEmail) {
    return Response.json(
      { ok: false, error: "RESEND_FROM_EMAIL is not configured — cannot send" },
      { status: 400 }
    );
  }
  if (!body.to.includes("@")) {
    return Response.json({ ok: false, error: "Invalid recipient email" }, { status: 400 });
  }

  try {
    const response = await client.emails.send({
      from: fromEmail,
      to: body.to,
      subject: "Bid Dashboard — Resend test email",
      text:
        "This is a test email from your Bid Dashboard.\n\n" +
        "If you received this, your Resend integration is configured correctly.\n\n" +
        "You can now send RFQ emails from the Subs tab on any bid.",
    });
    if (response.error) {
      return Response.json(
        { ok: false, error: response.error.message ?? String(response.error) },
        { status: 400 }
      );
    }
    return Response.json({
      ok: true,
      mode: "send",
      messageId: response.data?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
