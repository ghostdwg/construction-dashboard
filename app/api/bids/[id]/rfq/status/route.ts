// GET /api/bids/[id]/rfq/status
//
// Returns the latest email delivery status per subcontractor for this bid,
// keyed by subcontractorId. Used by the Subs tab to render delivery
// indicators next to each invited sub.
//
// Also returns whether the email service is configured, so the UI knows
// to disable the "Send RFQ" button when no RESEND_API_KEY is set.

import { prisma } from "@/lib/prisma";
import { isEmailConfigured } from "@/lib/services/email/resendClient";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  // Pull all email-channel outreach logs for this bid, ordered newest first.
  // Group in JS to pick the most recent per sub.
  const logs = await prisma.outreachLog.findMany({
    where: {
      bidId,
      channel: "email",
      subcontractorId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      subcontractorId: true,
      deliveryStatus: true,
      sentAt: true,
      openedAt: true,
      bouncedAt: true,
      bounceReason: true,
    },
  });

  type StatusEntry = {
    deliveryStatus: string | null;
    sentAt: string | null;
    openedAt: string | null;
    bouncedAt: string | null;
    bounceReason: string | null;
  };

  const bySubId: Record<number, StatusEntry> = {};
  for (const log of logs) {
    if (log.subcontractorId == null) continue;
    if (bySubId[log.subcontractorId]) continue; // already have a newer entry
    bySubId[log.subcontractorId] = {
      deliveryStatus: log.deliveryStatus,
      sentAt: log.sentAt?.toISOString() ?? null,
      openedAt: log.openedAt?.toISOString() ?? null,
      bouncedAt: log.bouncedAt?.toISOString() ?? null,
      bounceReason: log.bounceReason,
    };
  }

  return Response.json({
    emailConfigured: isEmailConfigured(),
    bySubId,
    estimatorDefaults: {
      name: process.env.ESTIMATOR_NAME ?? "",
      email: process.env.ESTIMATOR_EMAIL ?? "",
    },
  });
}
