// Resend client + sendRfqEmail service.
//
// Configuration sources (in priority order):
//   1. AppSetting DB row (managed via /settings → Email)
//   2. process.env.RESEND_API_KEY / RESEND_FROM_EMAIL (legacy fallback)
//
// All reads go through getSetting() so changes in the UI are picked up
// without restarting the server. The send route returns 503 when the API
// key is not configured by either source.

import { Resend } from "resend";
import RfqInvitation from "@/lib/emails/RfqInvitation";
import { getSetting } from "@/lib/services/settings/appSettingsService";

// ── Client factory ─────────────────────────────────────────────────────────

/**
 * Build a Resend client from the current API key. Returns null if no key is
 * configured. We don't memoize the client because the API key may change at
 * runtime via the settings page; constructing it is cheap.
 */
async function getResendClient(): Promise<Resend | null> {
  const apiKey = await getSetting("RESEND_API_KEY");
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function isEmailConfigured(): Promise<boolean> {
  const apiKey = await getSetting("RESEND_API_KEY");
  const fromEmail = await getSetting("RESEND_FROM_EMAIL");
  return Boolean(apiKey && fromEmail);
}

// ── sendRfqEmail ───────────────────────────────────────────────────────────

export type SendRfqParams = {
  to: string;
  subName: string;
  projectName: string;
  bidNumber: string;
  dueDate: string; // already-formatted display string
  trades: string[];
  scopeSummary: string;
  replyTo: string;
  estimatorName: string;
  customMessage?: string;
};

export type SendRfqResult = {
  messageId: string | null;
  status: "QUEUED" | "FAILED";
  error?: string;
};

export async function sendRfqEmail(params: SendRfqParams): Promise<SendRfqResult> {
  const client = await getResendClient();
  const fromEmail = await getSetting("RESEND_FROM_EMAIL");

  if (!client || !fromEmail) {
    return {
      messageId: null,
      status: "FAILED",
      error: "Email service not configured (RESEND_API_KEY or RESEND_FROM_EMAIL missing)",
    };
  }

  // Build subject. Keep trades concise; truncate after 3 with "+ N more".
  const tradeLabel =
    params.trades.length <= 3
      ? params.trades.join(", ")
      : `${params.trades.slice(0, 3).join(", ")} + ${params.trades.length - 3} more`;
  const subject = `Request for Quote — ${params.projectName} — ${tradeLabel}`;

  try {
    const response = await client.emails.send({
      from: fromEmail,
      to: params.to,
      replyTo: params.replyTo,
      subject,
      react: RfqInvitation({
        subName: params.subName,
        projectName: params.projectName,
        bidNumber: params.bidNumber,
        dueDate: params.dueDate,
        trades: params.trades,
        scopeSummary: params.scopeSummary,
        estimatorName: params.estimatorName,
        replyTo: params.replyTo,
        customMessage: params.customMessage,
      }),
    });

    if (response.error) {
      return {
        messageId: null,
        status: "FAILED",
        error: response.error.message ?? String(response.error),
      };
    }

    return {
      messageId: response.data?.id ?? null,
      status: "QUEUED",
    };
  } catch (err) {
    return {
      messageId: null,
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
