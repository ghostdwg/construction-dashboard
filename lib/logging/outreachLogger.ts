import { prisma } from "@/lib/prisma";
import type { OutreachLog } from "@prisma/client";

export async function logOutreachEvent(params: {
  bidId: number;
  subcontractorId?: number;
  contactId?: number;
  questionId?: number;
  channel: string;
  status: string;
  sentAt?: Date;
  notes?: string;
}): Promise<OutreachLog> {
  return prisma.outreachLog.create({
    data: {
      bidId: params.bidId,
      subcontractorId: params.subcontractorId ?? null,
      contactId: params.contactId ?? null,
      questionId: params.questionId ?? null,
      channel: params.channel,
      status: params.status,
      sentAt: params.sentAt ?? null,
      responseNotes: params.notes ?? null,
    },
  });
}
