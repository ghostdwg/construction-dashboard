// Module SET1+ — Active email provider factory
//
// Reads the EMAIL_PROVIDER setting and returns the matching EmailProvider
// instance. Used by the RFQ send route + the settings test endpoint so they
// don't have to know which vendor is configured.
//
// Default provider: "resend" (matches the original SET1 behavior).

import { getSetting } from "@/lib/services/settings/appSettingsService";
import { ResendProvider } from "./providers/resendProvider";
import { SmtpProvider } from "./providers/smtpProvider";
import type { EmailProvider } from "./types";

export type EmailProviderId = "resend" | "smtp";

export const EMAIL_PROVIDER_IDS: EmailProviderId[] = ["resend", "smtp"];

export function isValidEmailProviderId(s: string): s is EmailProviderId {
  return (EMAIL_PROVIDER_IDS as string[]).includes(s);
}

/**
 * Returns the EmailProvider currently selected via the EMAIL_PROVIDER setting.
 * Falls back to Resend if the setting is missing or invalid (matches the
 * original SET1 default).
 */
export async function getActiveEmailProvider(): Promise<EmailProvider> {
  const id = (await getSetting("EMAIL_PROVIDER")) ?? "resend";
  if (id === "smtp") return new SmtpProvider();
  return new ResendProvider();
}

/** Convenience: tells the UI which provider is active without instantiating. */
export async function getActiveEmailProviderId(): Promise<EmailProviderId> {
  const id = (await getSetting("EMAIL_PROVIDER")) ?? "resend";
  return isValidEmailProviderId(id) ? id : "resend";
}
