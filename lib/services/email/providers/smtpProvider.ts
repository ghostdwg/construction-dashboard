// Module SET1+ — Generic SMTP provider implementation
//
// Uses nodemailer to send mail through any SMTP server: Gmail, Outlook, Yahoo,
// iCloud, Fastmail, custom corporate relays, etc. Settings are managed via
// the AppSetting catalog (see appSettingsService.ts) so the user can switch
// providers from the UI without restarting.
//
// React Email templates are rendered to an HTML string via renderRfqHtml()
// before being handed to nodemailer.

import nodemailer, { type Transporter } from "nodemailer";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import { renderRfqHtml, renderRfqText } from "../renderRfqHtml";
import type {
  EmailProvider,
  SendRfqParams,
  SendRfqResult,
  SendTestResult,
  SendHtmlParams,
  ValidationResult,
} from "../types";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string | null;
};

async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  const [host, portStr, secureStr, user, password, fromEmail, fromName] =
    await Promise.all([
      getSetting("SMTP_HOST"),
      getSetting("SMTP_PORT"),
      getSetting("SMTP_SECURE"),
      getSetting("SMTP_USER"),
      getSetting("SMTP_PASSWORD"),
      getSetting("SMTP_FROM_EMAIL"),
      getSetting("SMTP_FROM_NAME"),
    ]);

  if (!host || !user || !password) return null;

  const port = portStr ? parseInt(portStr, 10) : 587;
  if (!Number.isFinite(port)) return null;

  return {
    host,
    port,
    secure: secureStr === "true",
    user,
    password,
    fromEmail: fromEmail || user, // default From to the auth user
    fromName: fromName || null,
  };
}

function buildTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
  });
}

function fromHeader(cfg: SmtpConfig): string {
  return cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail;
}

export class SmtpProvider implements EmailProvider {
  readonly id = "smtp" as const;
  readonly label = "SMTP (Gmail / Outlook / Yahoo / Custom)";

  async isConfigured(): Promise<boolean> {
    const cfg = await loadSmtpConfig();
    return cfg !== null;
  }

  async validateConnection(): Promise<ValidationResult> {
    const cfg = await loadSmtpConfig();
    if (!cfg) {
      return {
        ok: false,
        error: "SMTP not configured (host, user, and password required)",
      };
    }
    try {
      const transport = buildTransport(cfg);
      await transport.verify();
      return {
        ok: true,
        details: `Connected to ${cfg.host}:${cfg.port} as ${cfg.user}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async sendRfqEmail(params: SendRfqParams): Promise<SendRfqResult> {
    const cfg = await loadSmtpConfig();
    if (!cfg) {
      return {
        messageId: null,
        status: "FAILED",
        error: "SMTP is not configured (host, user, and password required)",
      };
    }

    const subject = buildSubject(params);

    try {
      const html = await renderRfqHtml({
        subName: params.subName,
        projectName: params.projectName,
        bidNumber: params.bidNumber,
        dueDate: params.dueDate,
        trades: params.trades,
        scopeSummary: params.scopeSummary,
        estimatorName: params.estimatorName,
        replyTo: params.replyTo,
        customMessage: params.customMessage,
      });
      const text = renderRfqText({
        subName: params.subName,
        projectName: params.projectName,
        bidNumber: params.bidNumber,
        dueDate: params.dueDate,
        trades: params.trades,
        scopeSummary: params.scopeSummary,
        estimatorName: params.estimatorName,
        replyTo: params.replyTo,
        customMessage: params.customMessage,
      });

      const transport = buildTransport(cfg);
      const info = await transport.sendMail({
        from: fromHeader(cfg),
        to: params.to,
        replyTo: params.replyTo,
        subject,
        html,
        text,
      });

      return {
        messageId: info.messageId ?? null,
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
    const cfg = await loadSmtpConfig();
    if (!cfg) return { ok: false, error: "SMTP is not configured" };
    if (!to.includes("@")) return { ok: false, error: "Invalid recipient email" };

    try {
      const transport = buildTransport(cfg);
      const info = await transport.sendMail({
        from: fromHeader(cfg),
        to,
        subject: "Bid Dashboard — SMTP test email",
        text:
          "This is a test email from your Bid Dashboard.\n\n" +
          "If you received this, your SMTP integration is configured correctly.\n\n" +
          `Sent via ${cfg.host}:${cfg.port} as ${cfg.user}.`,
      });
      return { ok: true, messageId: info.messageId ?? null };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async sendHtml(params: SendHtmlParams): Promise<SendRfqResult> {
    const cfg = await loadSmtpConfig();
    if (!cfg) {
      return { messageId: null, status: "FAILED", error: "SMTP is not configured" };
    }
    try {
      const transport = buildTransport(cfg);
      const info = await transport.sendMail({
        from: fromHeader(cfg),
        to: params.to,
        replyTo: params.replyTo,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return { messageId: info.messageId ?? null, status: "QUEUED" };
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
