// Module SET1+ — Render the RFQ React Email template to an HTML string.
//
// Resend renders React Email components natively when you pass `react:` to
// emails.send(). Nodemailer (used by the SMTP provider) needs an HTML string,
// so this helper bridges the gap.

import { render } from "@react-email/components";
import RfqInvitation from "@/lib/emails/RfqInvitation";

export type RfqRenderParams = {
  subName: string;
  projectName: string;
  bidNumber: string;
  dueDate: string;
  trades: string[];
  scopeSummary: string;
  estimatorName: string;
  replyTo: string;
  customMessage?: string;
};

export async function renderRfqHtml(params: RfqRenderParams): Promise<string> {
  return render(RfqInvitation(params));
}

/** Plain-text fallback for clients that won't render HTML. */
export function renderRfqText(params: RfqRenderParams): string {
  const tradeList =
    params.trades.length === 0
      ? "(see attached scope)"
      : params.trades.map((t) => `  - ${t}`).join("\n");

  const customBlock = params.customMessage
    ? `\n${params.customMessage}\n`
    : "";

  return [
    `Hello ${params.subName},`,
    "",
    `You're invited to bid on:`,
    "",
    `  Project: ${params.projectName}`,
    `  Bid #:   ${params.bidNumber}`,
    `  Due:     ${params.dueDate}`,
    "",
    `Trades requested:`,
    tradeList,
    "",
    params.scopeSummary ? `Scope summary:\n${params.scopeSummary}` : "",
    customBlock,
    `Please send your quote to: ${params.replyTo}`,
    "",
    `— ${params.estimatorName}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
