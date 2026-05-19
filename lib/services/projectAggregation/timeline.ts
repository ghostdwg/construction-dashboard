// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/timeline.ts
//  Phase MI-6 — Append-only chronological event recording.
//
//  Every state change, signal attach, entity attach, parcel attach, and
//  probability update writes a ProjectTimelineEvent. The UI renders these
//  in occurredAt order to show how the project evolved over time.
//
//  Helper functions package the most common event shapes so callers
//  (aggregator.ts, governance code) don't repeat themselves.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { TimelineEventType } from "./types";

interface BaseEventInput {
  projectId: string;
  eventType: TimelineEventType;
  occurredAt: Date;
  summary: string;
  payload?: Record<string, unknown> | null;
  sourceRefKind?: string | null;
  sourceRefId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
}

export async function recordTimelineEvent(input: BaseEventInput): Promise<void> {
  await prisma.projectTimelineEvent.create({
    data: {
      projectId: input.projectId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      summary: input.summary,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
      sourceRefKind: input.sourceRefKind ?? null,
      sourceRefId: input.sourceRefId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
    },
  });
}

/** Convenience for SIGNAL_ATTACHED events. */
export async function recordSignalAttached(args: {
  projectId: string;
  signalKind: string;
  sourceId: string | null;
  attachReason: string;
  attachScore: number;
  occurredAt: Date;
}): Promise<void> {
  await recordTimelineEvent({
    projectId: args.projectId,
    eventType: "SIGNAL_ATTACHED",
    occurredAt: args.occurredAt,
    summary: `${args.signalKind} attached (${(args.attachScore * 100).toFixed(0)}% — ${args.attachReason})`,
    payload: {
      signalKind: args.signalKind,
      sourceId: args.sourceId,
      attachScore: args.attachScore,
      attachReason: args.attachReason,
    },
    sourceRefKind: args.signalKind,
    sourceRefId: args.sourceId,
  });
}
