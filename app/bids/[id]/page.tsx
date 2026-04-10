import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import TabBar from "./TabBar";
import StatusButton from "./StatusButton";
import TradesTab from "./TradesTab";
import SubsTab from "./SubsTab";
import ScopeTab from "./ScopeTab";
import AiReviewTab from "./AiReviewTab";
import QuestionsTab from "./QuestionsTab";
import ActivityTab from "./ActivityTab";
import LevelingTab from "./LevelingTab";
import DocumentsTab from "./DocumentsTab";
import IntelligenceBrief from "./IntelligenceBrief";
import GoNoGoWidget from "./GoNoGoWidget";
import ComplianceWidget from "./ComplianceWidget";
import SubmissionPanel from "./SubmissionPanel";
import EditableDueDate from "./EditableDueDate";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

export default async function BidDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) notFound();

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      bidTrades: { include: { trade: true }, orderBy: { id: "asc" } },
      selections: {
        include: {
          subcontractor: {
            include: {
              contacts: { where: { isPrimary: true }, take: 1 },
              subTrades: { include: { trade: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!bid) notFound();

  // Leveling tab: subs with estimate-worthy RFQ status + any existing uploads
  const levelingSubs =
    tab === "leveling"
      ? bid.selections
          .filter((s) =>
            ["received", "reviewing", "accepted"].includes(s.rfqStatus)
          )
          .map((s) => ({
            id: s.subcontractor.id,
            company: s.subcontractor.company,
            tier: s.subcontractor.tier,
          }))
      : [];

  const estimateUploads =
    tab === "leveling"
      ? await prisma.estimateUpload.findMany({
          where: { bidId },
          select: {
            id: true,
            subcontractorId: true,
            fileName: true,
            fileType: true,
            fileSize: true,
            scopeLines: true,
            parseStatus: true,
            parseError: true,
            sanitizationStatus: true,
            sanitizedText: true,
            redactionCount: true,
            flaggedLines: true,
            subToken: true,
            approvedForAi: true,
            uploadedAt: true,
          },
          orderBy: { uploadedAt: "desc" },
        })
      : [];

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      {/* Header */}
      <div className="mb-6">
        <Link href="/bids" className="text-sm text-zinc-500 hover:underline">
          ← Bids
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-semibold">{bid.projectName}</h1>
            {bid.location && (
              <p className="text-sm text-zinc-500 mt-0.5">{bid.location}</p>
            )}
          </div>
          <StatusButton bidId={bid.id} current={bid.status} />
        </div>
      </div>

      {/* Tabs */}
      <Suspense fallback={<div className="h-10 border-b border-zinc-200 mb-6" />}>
        <TabBar bidId={bid.id} />
      </Suspense>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="flex flex-col gap-6">
          <section className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                Project Name
              </p>
              <p className="text-sm">{bid.projectName}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                Location
              </p>
              <p className="text-sm">{bid.location || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                Status
              </p>
              <p className="text-sm capitalize">{bid.status}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                Due Date
              </p>
              <EditableDueDate
                bidId={bid.id}
                initialDueDate={bid.dueDate ? bid.dueDate.toISOString() : null}
              />
            </div>
            {bid.description && (
              <div className="col-span-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
                  Description
                </p>
                <p className="text-sm text-zinc-600 whitespace-pre-wrap">
                  {bid.description}
                </p>
              </div>
            )}
          </section>

          <section>
            <SubmissionPanel bidId={bid.id} />
          </section>

          <section>
            <GoNoGoWidget bidId={bid.id} />
          </section>

          <section>
            <ComplianceWidget bidId={bid.id} />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-zinc-800 mb-3">Project Intelligence Brief</h2>
            <IntelligenceBrief bidId={bid.id} />
          </section>
        </div>
      )}

      {tab === "trades" && (
        <TradesTab bidId={bid.id} bidTrades={bid.bidTrades} />
      )}

      {tab === "subs" && (
        <SubsTab
          bidId={bid.id}
          initialSelections={bid.selections}
          bidTrades={bid.bidTrades}
          projectType={bid.projectType}
        />
      )}

      {tab === "scope" && (
        <ScopeTab bidId={bid.id} />
      )}

      {tab === "ai-review" && (
        <AiReviewTab bidId={bid.id} />
      )}

      {tab === "questions" && (
        <QuestionsTab bidId={bid.id} />
      )}

      {tab === "leveling" && (
        <LevelingTab
          bidId={bid.id}
          subs={levelingSubs}
          initialUploads={estimateUploads}
        />
      )}

      {tab === "activity" && (
        <ActivityTab bidId={bid.id} />
      )}

      {tab === "documents" && (
        <DocumentsTab bidId={bid.id} />
      )}
    </div>
  );
}
