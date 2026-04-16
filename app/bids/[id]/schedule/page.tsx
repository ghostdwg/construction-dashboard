// Phase 5C — Schedule V2 full-page editor
//
// Route: /bids/[id]/schedule
//
// Server component: fetches bid name for the header, then renders the
// ScheduleGrid client component which loads/manages all schedule state.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, CalendarDays } from "lucide-react";
import ScheduleGrid from "./components/ScheduleGrid";

type Params = Promise<{ id: string }>;

export default async function ScheduleV2Page({ params }: { params: Params }) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) notFound();

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, projectName: true },
  });
  if (!bid) notFound();

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 flex-shrink-0 bg-slate-900">
        <Link
          href={`/bids/${bidId}?tab=schedule`}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to bid
        </Link>
        <span className="text-slate-700">|</span>
        <CalendarDays className="w-4 h-4 text-blue-400" />
        <span className="font-medium text-sm truncate">{bid.projectName}</span>
        <span className="text-slate-600 text-sm">— Schedule Builder</span>
      </header>

      {/* Grid takes remaining height */}
      <div className="flex-1 overflow-hidden">
        <ScheduleGrid bidId={bidId} />
      </div>
    </div>
  );
}
