// POST /api/webhooks/resend
//
// Receives delivery event webhooks from Resend (https://resend.com/docs/dashboard/webhooks/introduction).
// Updates the matching OutreachLog row by emailMessageId.
//
// Resend event payload (relevant fields):
//   {
//     type: "email.sent" | "email.delivered" | "email.opened" |
//           "email.bounced" | "email.complained" | "email.delivery_delayed",
//     created_at: ISO string,
//     data: {
//       email_id: string,         // matches what we stored as emailMessageId
//       to: string[],
//       subject: string,
//       bounce?: { type: string, message: string },  // present on bounce
//       ...
//     }
//   }
//
// In dev/localhost, webhooks won't fire — that's fine. The send flow works
// without them. Webhooks activate when deployed to a public URL with the
// webhook endpoint registered in the Resend dashboard.

import { prisma } from "@/lib/prisma";

type ResendEventData = {
  email_id?: string;
  bounce?: { type?: string; message?: string };
};

type ResendEvent = {
  type?: string;
  data?: ResendEventData;
};

const TYPE_TO_STATUS: Record<string, string> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.opened": "OPENED",
  "email.bounced": "BOUNCED",
  "email.complained": "FAILED",
  "email.delivery_delayed": "QUEUED",
};

export async function POST(request: Request) {
  let event: ResendEvent;
  try {
    event = (await request.json()) as ResendEvent;
  } catch {
    // Resend won't retry malformed payloads, but we don't want to leak errors
    return Response.json({ ok: true });
  }

  const messageId = event.data?.email_id;
  const eventType = event.type ?? "";

  if (!messageId || !eventType) {
    return Response.json({ ok: true });
  }

  const newStatus = TYPE_TO_STATUS[eventType];
  if (!newStatus) {
    return Response.json({ ok: true });
  }

  // Look up the OutreachLog row by Resend message ID
  const log = await prisma.outreachLog.findFirst({
    where: { emailMessageId: messageId },
    select: { id: true },
  });

  if (!log) {
    // Could be a message we didn't send (test, other system) — silently ignore
    return Response.json({ ok: true });
  }

  const updateData: {
    deliveryStatus: string;
    openedAt?: Date;
    bouncedAt?: Date;
    bounceReason?: string;
  } = { deliveryStatus: newStatus };

  if (eventType === "email.opened") {
    updateData.openedAt = new Date();
  } else if (eventType === "email.bounced") {
    updateData.bouncedAt = new Date();
    updateData.bounceReason =
      event.data?.bounce?.type ?? event.data?.bounce?.message ?? "unknown";
  }

  try {
    await prisma.outreachLog.update({
      where: { id: log.id },
      data: updateData,
    });
  } catch (err) {
    // Don't error to Resend — we never want a webhook to bounce
    console.error("[webhooks/resend] update failed:", err);
  }

  return Response.json({ ok: true });
}
