import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ProjectContextBar from "./ProjectContextBar";
import TradesTab from "./TradesTab";
import SubsTab from "./SubsTab";
import ScopeTab from "./ScopeTab";
import DecisionLogTab from "./DecisionLogTab";
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
import JobHistoryPanel from "./JobHistoryPanel";
import MeetingActionsPanel from "./MeetingActionsPanel";
import AiBidUsageCard from "./AiBidUsageCard";
import ProjectStatusStrip from "./ProjectStatusStrip";

export const dynamic = "force-dynamic";

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

  const levelingSubs =
    tab === "leveling"
      ? bid.selections
          .filter((s) => ["received", "reviewing", "accepted"].includes(s.rfqStatus))
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

  const [overviewLevelingUploadCount, overviewHasBrief] =
    tab === "overview"
      ? await Promise.all([
          prisma.estimateUpload.count({
            where: { bidId },
          }),
          prisma.bidIntelligenceBrief.findFirst({
            where: { bidId },
            select: { id: true },
          }).then(Boolean),
        ])
      : [0, false];

  const overviewRespondedCount = bid.selections.filter((s) =>
    ["received", "reviewing", "accepted"].includes(s.rfqStatus)
  ).length;

  return (
    <div className="flex flex-col min-h-full">
      <ProjectContextBar
        bidId={bid.id}
        bidName={bid.projectName}
        location={bid.location ?? null}
        status={bid.status}
        workflowType={bid.workflowType ?? "BID"}
        activeTab={tab}
      />

      <div className="px-6 py-6 min-w-0 flex-1">


          {tab === "overview" && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2 flex-wrap -mb-2">
                <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500 select-none">
                  Status
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-600 dark:text-zinc-300">
                  {bid.status}
                </span>
                {bid.projectType && (
                  <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-400 dark:text-zinc-500">
                    {bid.projectType}
                  </span>
                )}
                {bid.workflowType && bid.workflowType !== "BID" && (
                  <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-400 dark:text-zinc-500">
                    {bid.workflowType}
                  </span>
                )}
              </div>

              <ProjectStatusStrip
                dueDate={bid.dueDate ? bid.dueDate.toISOString() : null}
                subCount={bid.selections.length}
                respondedCount={overviewRespondedCount}
                levelingUploadCount={overviewLevelingUploadCount}
                hasBrief={overviewHasBrief}
              />

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
                <MeetingActionsPanel bidId={bid.id} />
              </section>

              <section>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500 select-none whitespace-nowrap">
                    Glint Intelligence
                  </span>
                  <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                </div>
                <IntelligenceBrief bidId={bid.id} />
              </section>

              <section>
                <AiBidUsageCard bidId={bid.id} />
              </section>

              <section>
                <JobHistoryPanel bidId={bid.id} />
              </section>
            </div>
          )}

          {tab === "trades" && <TradesTab bidId={bid.id} bidTrades={bid.bidTrades} />}

          {tab === "subs" && (
            <SubsTab
              bidId={bid.id}
              initialSelections={bid.selections}
              bidTrades={bid.bidTrades}
              projectType={bid.projectType}
            />
          )}

          {tab === "scope" && <ScopeTab bidId={bid.id} />}
          {tab === "decisions" && <DecisionLogTab bidId={bid.id} />}
          {tab === "ai-review" && <AiReviewTab bidId={bid.id} />}
          {tab === "questions" && <QuestionsTab bidId={bid.id} />}
          {tab === "leveling" && (
            <LevelingTab bidId={bid.id} subs={levelingSubs} initialUploads={estimateUploads} />
          )}
          {tab === "activity" && <ActivityTab bidId={bid.id} />}
          {tab === "documents" && <DocumentsTab bidId={bid.id} />}
          {tab === "handoff" && <HandoffTab bidId={bid.id} />}
          {tab === "submittals" && <SubmittalsTab bidId={bid.id} />}
          {tab === "schedule" && <ScheduleTab bidId={bid.id} />}
          {tab === "meetings" && <MeetingsTab bidId={bid.id} />}
          {tab === "briefing" && <BriefingTab bidId={bid.id} />}
          {tab === "procore" && <ProcoreTab bidId={bid.id} />}
          {tab === "warranties" && <WarrantiesTab bidId={bid.id} />}
          {tab === "training" && <TrainingTab bidId={bid.id} />}
          {tab === "inspections" && <InspectionsTab bidId={bid.id} />}
          {tab === "closeout" && <CloseoutTab bidId={bid.id} />}
      </div>
    </div>
  );
}
