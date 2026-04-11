// Module SET1+ — SMTP provider presets
//
// Pre-filled host/port/secure values for common email providers. Used by the
// Email card's preset dropdown so users don't have to look up SMTP details.
//
// All ports use STARTTLS (port 587) by default, which is the modern standard.
// Port 465 with implicit SSL is included as "secure: true" for providers that
// still recommend it.

export type SmtpPreset = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean; // true = SSL on connect (465), false = STARTTLS (587)
  notes: string;
};

export const SMTP_PRESETS: SmtpPreset[] = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    notes:
      "Requires 2FA enabled on the account + an App Password (Google Account → Security → 2-Step Verification → App passwords).",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    notes:
      "Requires an App Password. Some M365 tenants disable SMTP AUTH by policy — your IT admin may need to enable it for your mailbox.",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: 587,
    secure: false,
    notes:
      "Requires an App Password (Yahoo Account → Account security → Generate app password).",
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    host: "smtp.mail.me.com",
    port: 587,
    secure: false,
    notes:
      "Requires an App-Specific Password (Apple ID → Sign-In and Security → App-Specific Passwords).",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    host: "smtp.fastmail.com",
    port: 465,
    secure: true,
    notes:
      "Requires an App Password (Fastmail → Settings → Privacy & Security → Integrations → New App Password).",
  },
  {
    id: "custom",
    label: "Custom SMTP",
    host: "",
    port: 587,
    secure: false,
    notes: "Enter the host, port, and secure flag from your email provider's documentation.",
  },
];

export function getPreset(id: string): SmtpPreset | null {
  return SMTP_PRESETS.find((p) => p.id === id) ?? null;
}
