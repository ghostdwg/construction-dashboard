// POST /api/bids/[id]/rfq/send
//
// Sends RFQ invitation emails via Resend to a list of selected subcontractors.
// Logs each send into OutreachLog with channel="email", status="sent", and the
// new delivery tracking fields (emailMessageId, deliveryStatus).
//
// Body:
//   {
//     subIds: number[],          // selection-time subcontractor IDs
//     customMessage?: string,    // optional note rendered into the email
//     estimatorName: string,
//     estimatorEmail: string
//   }
//
// Response:
//   {
//     sent:    [{ subId, subName, email, messageId }],
//     skipped: [{ subId, subName, reason }],
//     failed:  [{ subId, subName, error }]
//   }
//
// If RESEND_API_KEY is not configured, returns 503.

import { prisma } from "@/lib/prisma";
import { isEmailConfigured, sendRfqEmail } from "@/lib/services/email/resendClient";

type SendRequestBody = {
  subIds?: unknown;
  customMessage?: unknown;
  estimatorName?: unknown;
  estimatorEmail?: unknown;
};

function fmtDateLong(d: Date | null): string {
  if (!d) return "TBD";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isEmailConfigured()) {
    return Response.json(
      {
        error:
          "Email service not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to .env.local",
      },
      { status: 503 }
    );
  }

  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: SendRequestBody;
  try {
    body = (await request.json()) as SendRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate body
  const subIdsRaw = body.subIds;
  if (!Array.isArray(subIdsRaw) || subIdsRaw.length === 0) {
    return Response.json({ error: "subIds must be a non-empty array" }, { status: 400 });
  }
  const subIds = subIdsRaw
    .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n));
  if (subIds.length === 0) {
    return Response.json({ error: "subIds must contain valid numbers" }, { status: 400 });
  }

  const estimatorName =
    typeof body.estimatorName === "string" && body.estimatorName.trim().length > 0
      ? body.estimatorName.trim()
      : null;
  const estimatorEmail =
    typeof body.estimatorEmail === "string" && body.estimatorEmail.trim().length > 0
      ? body.estimatorEmail.trim()
      : null;

  if (!estimatorName) {
    return Response.json({ error: "estimatorName is required" }, { status: 400 });
  }
  if (!estimatorEmail || !estimatorEmail.includes("@")) {
    return Response.json({ error: "estimatorEmail is required and must be a valid email" }, { status: 400 });
  }

  const customMessage =
    typeof body.customMessage === "string" ? body.customMessage : undefined;

  // Load the bid + selections + subs in one query
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      bidTrades: { include: { trade: true } },
      intelligenceBrief: { select: { whatIsThisJob: true } },
    },
  });

  if (!bid) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  // Pull all relevant selections for the requested subs on this bid.
  // Subs may be invited on multiple trades — we'll group their trades together
  // for the email rather than send one email per trade.
  // BidInviteSelection has tradeId as a raw column (no trade relation), so we
  // resolve tradeId → trade name via the bidTrades we already loaded above.
  const selections = await prisma.bidInviteSelection.findMany({
    where: {
      bidId,
      subcontractorId: { in: subIds },
    },
    include: {
      subcontractor: {
        include: {
          contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
        },
      },
    },
  });

  const tradeNameById = new Map<number, string>();
  for (const bt of bid.bidTrades) {
    tradeNameById.set(bt.tradeId, bt.trade.name);
  }

  if (selections.length === 0) {
    return Response.json(
      { error: "No matching selections found for this bid" },
      { status: 404 }
    );
  }

  // Group by subcontractorId → list of trade names + first selection (for IDs)
  type SubGroup = {
    subcontractorId: number;
    company: string;
    contactEmail: string | null;
    contactId: number | null;
    trades: string[];
  };
  const groupMap = new Map<number, SubGroup>();
  for (const sel of selections) {
    const subId = sel.subcontractorId;
    if (subId == null) continue;
    let group = groupMap.get(subId);
    if (!group) {
      const contact = sel.subcontractor.contacts[0] ?? null;
      group = {
        subcontractorId: subId,
        company: sel.subcontractor.company,
        contactEmail: contact?.email ?? null,
        contactId: contact?.id ?? null,
        trades: [],
      };
      groupMap.set(subId, group);
    }
    const tradeName = sel.tradeId != null ? tradeNameById.get(sel.tradeId) : undefined;
    if (tradeName) group.trades.push(tradeName);
  }

  const groups = Array.from(groupMap.values());

  // Sender side params
  const projectName = bid.projectName;
  const bidNumber = `Bid #${bid.id}`;
  const dueDateDisplay = fmtDateLong(bid.dueDate);
  const scopeSummary = (bid.intelligenceBrief?.whatIsThisJob ?? "").slice(0, 600);

  const sent: Array<{ subId: number; subName: string; email: string; messageId: string }> = [];
  const skipped: Array<{ subId: number; subName: string; reason: string }> = [];
  const failed: Array<{ subId: number; subName: string; error: string }> = [];

  for (const group of groups) {
    if (!group.contactEmail || !group.contactEmail.includes("@")) {
      skipped.push({
        subId: group.subcontractorId,
        subName: group.company,
        reason: "no email on primary contact",
      });
      continue;
    }

    // Dedupe trades
    const trades = Array.from(new Set(group.trades));

    const result = await sendRfqEmail({
      to: group.contactEmail,
      subName: group.company,
      projectName,
      bidNumber,
      dueDate: dueDateDisplay,
      trades,
      scopeSummary,
      replyTo: estimatorEmail,
      estimatorName,
      customMessage,
    });

    // Always create an OutreachLog row, even on failure
    await prisma.outreachLog.create({
      data: {
        bidId,
        subcontractorId: group.subcontractorId,
        contactId: group.contactId,
        channel: "email",
        status: result.status === "QUEUED" ? "sent" : "exported",
        sentAt: result.status === "QUEUED" ? new Date() : null,
        emailMessageId: result.messageId,
        deliveryStatus: result.status,
        // Custom message is rendered into the email body and not persisted to
        // OutreachLog (option (b) per design discussion). If we ever need an
        // audit trail of outbound text, add an outboundMessage column.
      },
    });

    if (result.status === "QUEUED" && result.messageId) {
      sent.push({
        subId: group.subcontractorId,
        subName: group.company,
        email: group.contactEmail,
        messageId: result.messageId,
      });

      // Bump rfqStatus on the BidInviteSelection rows for this sub from
      // "no_response" → "invited" so the existing UI reflects the send.
      await prisma.bidInviteSelection.updateMany({
        where: {
          bidId,
          subcontractorId: group.subcontractorId,
          rfqStatus: "no_response",
        },
        data: { rfqStatus: "invited" },
      });
    } else {
      failed.push({
        subId: group.subcontractorId,
        subName: group.company,
        error: result.error ?? "Unknown send failure",
      });
    }
  }

  return Response.json({ sent, skipped, failed });
}
