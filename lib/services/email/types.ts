// Module SET1+ — Email provider abstraction
//
// Defines the contract every email provider must satisfy. The RFQ send route
// and the settings test endpoint go through getActiveEmailProvider() so they
// don't have to know whether mail goes out via Resend, generic SMTP, or
// (someday) Microsoft Graph.

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

export type ValidationResult =
  | { ok: true; details?: string }
  | { ok: false; error: string };

export type SendTestResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export interface EmailProvider {
  /** Stable id matching the EMAIL_PROVIDER setting value. */
  readonly id: "resend" | "smtp";
  /** Human label for the UI. */
  readonly label: string;

  /** Returns true when this provider has all required settings populated. */
  isConfigured(): Promise<boolean>;

  /**
   * Validates credentials without sending mail. For Resend this hits the
   * /api-keys endpoint; for SMTP it runs `transporter.verify()`.
   */
  validateConnection(): Promise<ValidationResult>;

  /** Sends a real RFQ invitation email. */
  sendRfqEmail(params: SendRfqParams): Promise<SendRfqResult>;

  /** Sends a small "this is a test" message to a single recipient. */
  sendTestEmail(to: string): Promise<SendTestResult>;

  /**
   * Generic send: accepts pre-rendered HTML + plain-text body. Used by
   * notification systems (H8 award notifications, future templates) so the
   * provider interface doesn't need a method per email type.
   */
  sendHtml(params: SendHtmlParams): Promise<SendRfqResult>;
}

export type SendHtmlParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};
