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
import JobIntakePanel from "./JobIntakePanel";
import ProjectContactsPanel from "./ProjectContactsPanel";
import SubTabBar from "./SubTabBar";
import HandoffTab from "./HandoffTab";
import SubmittalsTab from "./SubmittalsTab";
import ScheduleTab from "./ScheduleTab";
import MeetingsTab from "./MeetingsTab";
import BriefingTab from "./BriefingTab";
import ProcoreTab from "./ProcoreTab";
import WarrantiesTab from "./WarrantiesTab";
import TrainingTab from "./TrainingTab";
import InspectionsTab from "./InspectionsTab";
import CloseoutTab from "./CloseoutTab";

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
    <div className="max-w-screen-2xl py-10 px-6">
      {/* ── Header (full width) ── */}
      <div className="mb-6">
        <Link href="/bids" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Bids
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-semibold">{bid.projectName}</h1>
            {bid.location && (
              <p className="text-sm text-zinc-500 mt-0.5 dark:text-zinc-400">{bid.location}</p>
            )}
          </div>
          <StatusButton bidId={bid.id} current={bid.status} />
        </div>
      </div>

      {/* ── Sidebar + Content grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] gap-6">
        {/* Sidebar */}
        <Suspense fallback={<div className="min-w-[210px]" />}>
          <TabBar bidId={bid.id} bidStatus={bid.status} workflowType={bid.workflowType} />
        </Suspense>

        {/* Content */}
        <div className="min-w-0">
          <SubTabBar tab={tab} bidId={bid.id} workflowType={bid.workflowType} />

          {tab === "overview" && (
            <div className="flex flex-col gap-6">
              <section className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1 dark:text-zinc-500">
                    Project Name
                  </p>
                  <p className="text-sm">{bid.projectName}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1 dark:text-zinc-500">
                    Location
                  </p>
                  <p className="text-sm">{bid.location || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1 dark:text-zinc-500">
                    Status
                  </p>
                  <p className="text-sm capitalize">{bid.status}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1 dark:text-zinc-500">
                    Due Date
                  </p>
                  <EditableDueDate
                    bidId={bid.id}
                    initialDueDate={bid.dueDate ? bid.dueDate.toISOString() : null}
                  />
                </div>
                {bid.description && (
                  <div className="col-span-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1 dark:text-zinc-500">
                      Description
                    </p>
                    <p className="text-sm text-zinc-600 whitespace-pre-wrap dark:text-zinc-300">
                      {bid.description}
                    </p>
                  </div>
                )}
              </section>

              <section>
                <JobIntakePanel
                  bidId={bid.id}
                  initial={{
                    projectType: bid.projectType,
                    deliveryMethod: bid.deliveryMethod,
                    ownerType: bid.ownerType,
                    buildingType: bid.buildingType,
                    approxSqft: bid.approxSqft,
                    stories: bid.stories,
                    ldAmountPerDay: bid.ldAmountPerDay,
                    ldCapAmount: bid.ldCapAmount,
                    occupiedSpace: bid.occupiedSpace,
                    phasingRequired: bid.phasingRequired,
                    siteConstraints: bid.siteConstraints,
                    estimatorNotes: bid.estimatorNotes,
                    scopeBoundaryNotes: bid.scopeBoundaryNotes,
                    veInterest: bid.veInterest,
                    dbeGoalPercent: bid.dbeGoalPercent,
                    constructionStartDate: bid.constructionStartDate
                      ? bid.constructionStartDate.toISOString()
                      : null,
                  }}
                />
              </section>

              <section>
                <ProjectContactsPanel bidId={bid.id} />
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
                <h2 className="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100">Project Intelligence Brief</h2>
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

          {tab === "warranties" && (
            <WarrantiesTab bidId={bid.id} />
          )}

          {tab === "training" && (
            <TrainingTab bidId={bid.id} />
          )}

          {tab === "inspections" && (
            <InspectionsTab bidId={bid.id} />
          )}

          {tab === "closeout" && (
            <CloseoutTab bidId={bid.id} />
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

          {tab === "handoff" && (
            <HandoffTab bidId={bid.id} />
          )}

          {tab === "submittals" && (
            <SubmittalsTab bidId={bid.id} />
          )}

          {tab === "schedule" && (
            <ScheduleTab bidId={bid.id} />
          )}

          {tab === "meetings" && (
            <MeetingsTab bidId={bid.id} />
          )}

          {tab === "briefing" && (
            <BriefingTab bidId={bid.id} />
          )}

          {tab === "procore" && (
            <ProcoreTab bidId={bid.id} />
          )}
        </div>
      </div>
    </div>
  );
}
