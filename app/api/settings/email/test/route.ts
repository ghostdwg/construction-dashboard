// POST /api/settings/email/test
//
// Tests the currently active email provider (Resend or SMTP). Two modes:
//   - Validate-only (no `to` in body): runs the provider's validateConnection()
//     to verify credentials without sending mail.
//   - Send (with `to` in body): sends a real test email to that address.
//
// Body (optional): { to?: string }
//
// Response:
//   { ok: true,  mode: "validate", provider: "resend"|"smtp", details?: string }
//   { ok: true,  mode: "send", provider: "resend"|"smtp", messageId: string|null }
//   { ok: false, error: string }

import { isAdminAuthorized } from "@/lib/auth";
import { getActiveEmailProvider } from "@/lib/services/email/getActiveProvider";

export async function POST(request: Request) {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }
  let body: { to?: string };
  try {
    body = (await request.json().catch(() => ({}))) as { to?: string };
  } catch {
    body = {};
  }

  const provider = await getActiveEmailProvider();

  // Mode 1: validate-only
  if (!body.to) {
    const result = await provider.validateConnection();
    if (result.ok) {
      return Response.json({
        ok: true,
        mode: "validate",
        provider: provider.id,
        details: result.details ?? null,
      });
    }
    return Response.json(
      { ok: false, provider: provider.id, error: result.error },
      { status: 400 }
    );
  }

  // Mode 2: real send
  const result = await provider.sendTestEmail(body.to);
  if (result.ok) {
    return Response.json({
      ok: true,
      mode: "send",
      provider: provider.id,
      messageId: result.messageId,
    });
  }
  return Response.json(
    { ok: false, provider: provider.id, error: result.error },
    { status: 400 }
  );
}
