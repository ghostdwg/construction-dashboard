// Resend client + sendRfqEmail service.
//
// Configuration (set in .env.local):
//   RESEND_API_KEY      — required to actually send mail; absent → 503 from API
//   RESEND_FROM_EMAIL   — required, must be a verified sender domain in Resend
//
// The send route in app/api/bids/[id]/rfq/send/route.ts is responsible for
// returning the 503 when the key is missing. This file is a thin service
// layer — it does not throw on missing config, it returns a structured error.

import { Resend } from "resend";
import RfqInvitation from "@/lib/emails/RfqInvitation";

// ── Singleton client ───────────────────────────────────────────────────────

let _client: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    _client = new Resend(apiKey);
  }
  return _client;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
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
  const client = getResendClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;

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
