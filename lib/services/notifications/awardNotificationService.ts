// Module H8 — Award Notification service
//
// Orchestrates preview, send, and status for award notification emails. Two
// audiences: awarded subcontractors (congratulations + next steps) and the
// project team (internal summary of who was awarded). Renders email templates
// to HTML and passes them to the active email provider's generic sendHtml().
//
// Logged via OutreachLog with channel="award_notification" (subs) or
// "internal_notification" (team). recipientEmail stores the target for
// non-sub recipients since OutreachLog's FK structure is sub-oriented.

import { prisma } from "@/lib/prisma";
import { render } from "@react-email/components";
import AwardNotification from "@/lib/emails/AwardNotification";
import InternalAwardNotification from "@/lib/emails/InternalAwardNotification";
import { getActiveEmailProvider } from "@/lib/services/email/getActiveProvider";
import { getSetting } from "@/lib/services/settings/appSettingsService";
import {
  loadProjectContactsForBid,
  CONTACT_ROLES,
} from "@/lib/services/contacts/projectContactService";

// ── Types ──────────────────────────────────────────────────────────────────

export type SubRecipient = {
  subcontractorId: number;
  company: string;
  contactId: number | null;
  contactName: string | null;
  email: string | null;
  trades: string[];
};

export type TeamRecipient = {
  projectContactId: number;
  name: string;
  role: string;
  roleLabel: string;
  email: string | null;
};

export type AwardNotificationPreview = {
  subRecipients: SubRecipient[];
  teamRecipients: TeamRecipient[];
  estimatorDefaults: { name: string; email: string };
  emailConfigured: boolean;
  alreadySentCount: number;
};

export type SendOptions = {
  estimatorName: string;
  estimatorEmail: string;
  customMessage?: string;
  sendToSubs: boolean;
  sendToTeam: boolean;
};

export type SendResult = {
  sent: Array<{ type: "sub" | "team"; name: string; email: string; messageId: string | null }>;
  skipped: Array<{ type: "sub" | "team"; name: string; reason: string }>;
  failed: Array<{ type: "sub" | "team"; name: string; error: string }>;
};

export type NotificationLogEntry = {
  id: number;
  type: "sub" | "team";
  name: string;
  email: string;
  deliveryStatus: string | null;
  sentAt: string | null;
};

export type NotificationStatus = {
  logs: NotificationLogEntry[];
  sentAt: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  CONTACT_ROLES.map((r) => [
    r,
    r
      .replace("INTERNAL_", "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  ])
);

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  LOI_SENT: "LOI Sent",
  CONTRACT_SENT: "Contract Sent",
  CONTRACT_SIGNED: "Signed",
  PO_ISSUED: "PO Issued",
  ACTIVE: "Active",
  CLOSED: "Closed",
};

// ── Preview ─────────────────────────────────────────────────────────────────

export async function previewAwardNotifications(
  bidId: number
): Promise<AwardNotificationPreview | null> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true },
  });
  if (!bid) return null;

  // Sub recipients from BuyoutItem.subcontractorId
  const buyouts = await prisma.buyoutItem.findMany({
    where: { bidId, subcontractorId: { not: null } },
    include: {
      bidTrade: { include: { trade: true } },
      subcontractor: {
        include: {
          contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
        },
      },
    },
  });

  type SubGroup = SubRecipient;
  const bySubId = new Map<number, SubGroup>();
  for (const b of buyouts) {
    if (!b.subcontractorId || !b.subcontractor) continue;
    let group = bySubId.get(b.subcontractorId);
    if (!group) {
      const c = b.subcontractor.contacts[0] ?? null;
      group = {
        subcontractorId: b.subcontractorId,
        company: b.subcontractor.company,
        contactId: c?.id ?? null,
        contactName: c?.name ?? null,
        email: c?.email ?? null,
        trades: [],
      };
      bySubId.set(b.subcontractorId, group);
    }
    group.trades.push(b.bidTrade.trade.name);
  }
  const subRecipients = Array.from(bySubId.values());

  // Team recipients from ProjectContact
  const teamContacts = await loadProjectContactsForBid(bidId);
  const teamRecipients: TeamRecipient[] = teamContacts.map((c) => ({
    projectContactId: c.id,
    name: c.name,
    role: c.role,
    roleLabel: ROLE_LABELS[c.role] ?? c.role,
    email: c.email,
  }));

  // Check existing notifications
  const alreadySentCount = await prisma.outreachLog.count({
    where: {
      bidId,
      channel: { in: ["award_notification", "internal_notification"] },
    },
  });

  const provider = await getActiveEmailProvider();
  const emailConfigured = await provider.isConfigured();

  const [estName, estEmail] = await Promise.all([
    getSetting("ESTIMATOR_NAME"),
    getSetting("ESTIMATOR_EMAIL"),
  ]);

  return {
    subRecipients,
    teamRecipients,
    estimatorDefaults: {
      name: estName ?? "",
      email: estEmail ?? "",
    },
    emailConfigured,
    alreadySentCount,
  };
}

// ── Send ────────────────────────────────────────────────────────────────────

export async function sendAwardNotifications(
  bidId: number,
  options: SendOptions
): Promise<SendResult> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, projectName: true },
  });
  if (!bid) throw new Error("Bid not found");

  const provider = await getActiveEmailProvider();
  if (!(await provider.isConfigured())) {
    throw new Error("Email provider is not configured");
  }

  const bidNumber = `Bid #${bid.id}`;
  const result: SendResult = { sent: [], skipped: [], failed: [] };

  // ── Sub notifications ─────────────────────────────────────────────────
  if (options.sendToSubs) {
    const preview = await previewAwardNotifications(bidId);
    if (!preview) throw new Error("Bid not found");

    for (const sub of preview.subRecipients) {
      if (!sub.email || !sub.email.includes("@")) {
        result.skipped.push({
          type: "sub",
          name: sub.company,
          reason: "no email on primary contact",
        });
        continue;
      }

      const trades = Array.from(new Set(sub.trades));
      const html = await render(
        AwardNotification({
          subName: sub.company,
          projectName: bid.projectName,
          bidNumber,
          trades,
          estimatorName: options.estimatorName,
          replyTo: options.estimatorEmail,
          customMessage: options.customMessage,
        })
      );
      const tradeLabel =
        trades.length <= 3
          ? trades.join(", ")
          : `${trades.slice(0, 3).join(", ")} + ${trades.length - 3} more`;
      const subject = `Award Notification — ${bid.projectName} — ${tradeLabel}`;
      const text = `Congratulations ${sub.company} — you have been awarded ${tradeLabel} on ${bid.projectName} (${bidNumber}). ${options.estimatorName} will follow up with contract details. Reply to: ${options.estimatorEmail}`;

      const sendResult = await provider.sendHtml({
        to: sub.email,
        subject,
        html,
        text,
        replyTo: options.estimatorEmail,
      });

      await prisma.outreachLog.create({
        data: {
          bidId,
          subcontractorId: sub.subcontractorId,
          contactId: sub.contactId,
          recipientEmail: sub.email,
          channel: "award_notification",
          status: sendResult.status === "QUEUED" ? "sent" : "exported",
          sentAt: sendResult.status === "QUEUED" ? new Date() : null,
          emailMessageId: sendResult.messageId,
          deliveryStatus: sendResult.status,
        },
      });

      if (sendResult.status === "QUEUED") {
        result.sent.push({
          type: "sub",
          name: sub.company,
          email: sub.email,
          messageId: sendResult.messageId,
        });
      } else {
        result.failed.push({
          type: "sub",
          name: sub.company,
          error: sendResult.error ?? "Unknown send failure",
        });
      }
    }
  }

  // ── Team notifications ────────────────────────────────────────────────
  if (options.sendToTeam) {
    const teamContacts = await loadProjectContactsForBid(bidId);

    // Build awarded trades summary for the internal email
    const buyouts = await prisma.buyoutItem.findMany({
      where: { bidId, subcontractorId: { not: null } },
      include: {
        bidTrade: { include: { trade: true } },
        subcontractor: { select: { company: true } },
      },
      orderBy: { bidTradeId: "asc" },
    });
    const awardedTrades = buyouts
      .filter((b) => b.subcontractor)
      .map((b) => ({
        tradeName: b.bidTrade.trade.name,
        subName: b.subcontractor!.company,
        contractStatus:
          CONTRACT_STATUS_LABELS[b.contractStatus] ?? b.contractStatus,
      }));

    for (const contact of teamContacts) {
      if (!contact.email || !contact.email.includes("@")) {
        result.skipped.push({
          type: "team",
          name: contact.name,
          reason: "no email",
        });
        continue;
      }

      const html = await render(
        InternalAwardNotification({
          recipientName: contact.name,
          projectName: bid.projectName,
          bidNumber,
          awardedTrades,
          estimatorName: options.estimatorName,
          replyTo: options.estimatorEmail,
          customMessage: options.customMessage,
        })
      );
      const subject = `Award Summary — ${bid.projectName} — Subcontractor Awards`;
      const text = `Award summary for ${bid.projectName} (${bidNumber}): ${awardedTrades.length} trades awarded. Contact ${options.estimatorName} at ${options.estimatorEmail} for the full handoff packet.`;

      const sendResult = await provider.sendHtml({
        to: contact.email,
        subject,
        html,
        text,
        replyTo: options.estimatorEmail,
      });

      await prisma.outreachLog.create({
        data: {
          bidId,
          recipientEmail: contact.email,
          channel: "internal_notification",
          status: sendResult.status === "QUEUED" ? "sent" : "exported",
          sentAt: sendResult.status === "QUEUED" ? new Date() : null,
          emailMessageId: sendResult.messageId,
          deliveryStatus: sendResult.status,
        },
      });

      if (sendResult.status === "QUEUED") {
        result.sent.push({
          type: "team",
          name: contact.name,
          email: contact.email,
          messageId: sendResult.messageId,
        });
      } else {
        result.failed.push({
          type: "team",
          name: contact.name,
          error: sendResult.error ?? "Unknown send failure",
        });
      }
    }
  }

  return result;
}

// ── Status ──────────────────────────────────────────────────────────────────

export async function getAwardNotificationStatus(
  bidId: number
): Promise<NotificationStatus> {
  const logs = await prisma.outreachLog.findMany({
    where: {
      bidId,
      channel: { in: ["award_notification", "internal_notification"] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      subcontractor: { select: { company: true } },
    },
  });

  const mapped: NotificationLogEntry[] = logs.map((log) => ({
    id: log.id,
    type: log.channel === "award_notification" ? "sub" as const : "team" as const,
    name:
      log.subcontractor?.company ??
      log.recipientEmail ??
      "Unknown",
    email: log.recipientEmail ?? "—",
    deliveryStatus: log.deliveryStatus,
    sentAt: log.sentAt?.toISOString() ?? null,
  }));

  const earliest = logs.length > 0
    ? logs.reduce((min, l) =>
        l.sentAt && (!min || l.sentAt < min) ? l.sentAt : min,
        null as Date | null
      )
    : null;

  return {
    logs: mapped,
    sentAt: earliest?.toISOString() ?? null,
  };
}
