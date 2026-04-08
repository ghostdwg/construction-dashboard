// ── calculateTimeline.ts ──────────────────────────────────────────────────
// Pure date-math utility — no DB access, no AI calls.
// Called from GET /api/bids/[id]/procurement/timeline.

export type TierValue = "TIER1" | "TIER2" | "TIER3";

export type TimelineStatus = "ON_TRACK" | "AT_RISK" | "OVERDUE" | "COMPLETE";
export type TimelineUrgency = "IMMEDIATE" | "THIS_WEEK" | "UPCOMING" | "OK";

export type TimelineEntry = {
  tradeId: number;
  tradeName: string;
  tier: TierValue;
  leadTimeDays: number | null;
  rfqSendDate: Date;
  quoteDueDate: Date;
  followUpDate: Date;
  finalQuoteDate: Date;
  daysUntilRfqSend: number;
  daysUntilQuoteDue: number;
  status: TimelineStatus;
  urgency: TimelineUrgency;
};

export type TimelineInput = {
  tradeId: number;
  tradeName: string;
  /** Stored as string in DB — must be TIER1 | TIER2 | TIER3 */
  tier: string;
  leadTimeDays: number | null;
  bidDueDate: Date;
  projectType: string; // PUBLIC | PRIVATE | NEGOTIATED
  // RFQ activity — for status calculation
  rfqSentAt?: Date | null;
  quotesReceivedAt?: Date | null;
  inviteCount?: number;
  estimateCount?: number;
};

// ── Offsets (days before bid due date) ────────────────────────────────────

type Offsets = { rfq: number; followUp: number; quote: number; final: number };

const BASE_OFFSETS: Record<TierValue, Offsets> = {
  TIER1: { rfq: 14, followUp: 10, quote: 7,  final: 3 },
  TIER2: { rfq: 10, followUp: 7,  quote: 5,  final: 3 },
  TIER3: { rfq: 7,  followUp: 5,  quote: 3,  final: 2 },
};

const PUBLIC_EXTRA = 3; // days added to all offsets for PUBLIC bids

// ── Helpers ───────────────────────────────────────────────────────────────

function subtractDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  // Normalize to start of day (UTC) so date comparisons are day-accurate
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Main export ───────────────────────────────────────────────────────────

export function calculateTimeline(input: TimelineInput): TimelineEntry {
  const tier: TierValue =
    input.tier === "TIER1" || input.tier === "TIER2" || input.tier === "TIER3"
      ? input.tier
      : "TIER2";

  const isPublic = input.projectType === "PUBLIC";
  const extra = isPublic ? PUBLIC_EXTRA : 0;

  const base = BASE_OFFSETS[tier];

  // Apply PUBLIC extra to all offsets
  const offsets: Offsets = {
    rfq:      base.rfq      + extra,
    followUp: base.followUp + extra,
    quote:    base.quote    + extra,
    final:    base.final    + extra,
  };

  // leadTimeDays override — use whichever is larger
  if (input.leadTimeDays != null && input.leadTimeDays > offsets.rfq) {
    offsets.rfq = input.leadTimeDays;
  }

  const due = new Date(input.bidDueDate);
  due.setUTCHours(0, 0, 0, 0);

  const rfqSendDate    = subtractDays(due, offsets.rfq);
  const followUpDate   = subtractDays(due, offsets.followUp);
  const quoteDueDate   = subtractDays(due, offsets.quote);
  const finalQuoteDate = subtractDays(due, offsets.final);

  const today = todayStart();
  const daysUntilRfqSend  = daysBetween(today, rfqSendDate);
  const daysUntilQuoteDue = daysBetween(today, quoteDueDate);

  // ── Status ───────────────────────────────────────────────────────────────
  // COMPLETE: quotes received
  // OVERDUE:  rfq date passed, no invites sent
  // AT_RISK:  rfq date within 3 days, no invites sent
  // ON_TRACK: otherwise

  const rfqSent = !!input.rfqSentAt || (input.inviteCount != null && input.inviteCount > 0);
  const quotesIn = !!input.quotesReceivedAt || (input.estimateCount != null && input.estimateCount > 0);

  let status: TimelineStatus;
  if (quotesIn) {
    status = "COMPLETE";
  } else if (!rfqSent && daysUntilRfqSend < 0) {
    status = "OVERDUE";
  } else if (!rfqSent && daysUntilRfqSend <= 3) {
    status = "AT_RISK";
  } else {
    status = "ON_TRACK";
  }

  // ── Urgency ───────────────────────────────────────────────────────────────
  let urgency: TimelineUrgency;
  if (daysUntilRfqSend <= 0) {
    urgency = "IMMEDIATE";
  } else if (daysUntilRfqSend <= 7) {
    urgency = "THIS_WEEK";
  } else if (daysUntilRfqSend <= 14) {
    urgency = "UPCOMING";
  } else {
    urgency = "OK";
  }

  return {
    tradeId: input.tradeId,
    tradeName: input.tradeName,
    tier,
    leadTimeDays: input.leadTimeDays ?? null,
    rfqSendDate,
    quoteDueDate,
    followUpDate,
    finalQuoteDate,
    daysUntilRfqSend,
    daysUntilQuoteDue,
    status,
    urgency,
  };
}
