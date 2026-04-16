// Module SET1+ — Resend provider implementation
//
// Wraps the existing Resend client behind the EmailProvider interface so the
// rest of the app can talk to a generic provider regardless of vendor.

import { Resend } from "resend";
import RfqInvitation from "@/lib/emails/RfqInvitation";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import type {
  EmailProvider,
  SendRfqParams,
  SendRfqResult,
  SendTestResult,
  SendHtmlParams,
  ValidationResult,
} from "../types";

export class ResendProvider implements EmailProvider {
  readonly id = "resend" as const;
  readonly label = "Resend";

  private async getClient(): Promise<Resend | null> {
    const apiKey = await getSetting("RESEND_API_KEY");
    if (!apiKey) return null;
    return new Resend(apiKey);
  }

  async isConfigured(): Promise<boolean> {
    const apiKey = await getSetting("RESEND_API_KEY");
    const fromEmail = await getSetting("RESEND_FROM_EMAIL");
    return Boolean(apiKey && fromEmail);
  }

  async validateConnection(): Promise<ValidationResult> {
    const client = await this.getClient();
    if (!client) return { ok: false, error: "RESEND_API_KEY is not configured" };

    try {
      const result = await client.apiKeys.list();
      if (result.error) {
        return {
          ok: false,
          error: result.error.message ?? "Resend rejected the API key",
        };
      }
      return { ok: true, details: "API key accepted by Resend" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async sendRfqEmail(params: SendRfqParams): Promise<SendRfqResult> {
    const client = await this.getClient();
    const fromEmail = await getSetting("RESEND_FROM_EMAIL");

    if (!client || !fromEmail) {
      return {
        messageId: null,
        status: "FAILED",
        error: "Resend is not configured (RESEND_API_KEY or RESEND_FROM_EMAIL missing)",
      };
    }

    const subject = buildSubject(params);

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

  async sendTestEmail(to: string): Promise<SendTestResult> {
    const client = await this.getClient();
    const fromEmail = await getSetting("RESEND_FROM_EMAIL");

    if (!client || !fromEmail) {
      return { ok: false, error: "Resend is not configured" };
    }
    if (!to.includes("@")) {
      return { ok: false, error: "Invalid recipient email" };
    }

    try {
      const response = await client.emails.send({
        from: fromEmail,
        to,
        subject: "Construction Dashboard — Resend test email",
        text:
          "This is a test email from your Construction Dashboard.\n\n" +
          "If you received this, your Resend integration is configured correctly.\n\n" +
          "You can now send RFQ emails from the Subs tab on any bid.",
      });
      if (response.error) {
        return {
          ok: false,
          error: response.error.message ?? String(response.error),
        };
      }
      return { ok: true, messageId: response.data?.id ?? null };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async sendHtml(params: SendHtmlParams): Promise<SendRfqResult> {
    const client = await this.getClient();
    const fromEmail = await getSetting("RESEND_FROM_EMAIL");
    if (!client || !fromEmail) {
      return { messageId: null, status: "FAILED", error: "Resend is not configured" };
    }
    try {
      const response = await client.emails.send({
        from: fromEmail,
        to: params.to,
        replyTo: params.replyTo,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      if (response.error) {
        return { messageId: null, status: "FAILED", error: response.error.message ?? String(response.error) };
      }
      return { messageId: response.data?.id ?? null, status: "QUEUED" };
    } catch (err) {
      return { messageId: null, status: "FAILED", error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function buildSubject(params: SendRfqParams): string {
  const tradeLabel =
    params.trades.length <= 3
      ? params.trades.join(", ")
      : `${params.trades.slice(0, 3).join(", ")} + ${params.trades.length - 3} more`;
  return `Request for Quote — ${params.projectName} — ${tradeLabel}`;
}
