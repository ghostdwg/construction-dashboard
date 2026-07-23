import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { bidScopeFilter, getUser } from "@/lib/auth-helpers";
import QuickPushButton from "./QuickPushButton";
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
import PursuitOriginCard from "./PursuitOriginCard";
import ProjectContactsPanel from "./ProjectContactsPanel";
import HandoffTab from "./HandoffTab";
import SubmittalsTab from "./SubmittalsTab";
import ScheduleTab from "./ScheduleTab";
import MeetingsTab from "./MeetingsTab";
import TasksTab from "./TasksTab";
import BriefingTab from "./BriefingTab";
import ProcoreTab from "./ProcoreTab";
import OperationsRegisterTab from "./OperationsRegisterTab";
import WarrantiesTab from "./WarrantiesTab";
import TrainingTab from "./TrainingTab";
import InspectionsTab from "./InspectionsTab";
import SpecSectionsTab from "./SpecSectionsTab";
import SpecRequirementsTab from "./SpecRequirementsTab";
import SpecVersionsTab from "./SpecVersionsTab";
import CloseoutTab from "./CloseoutTab";
import JobHistoryPanel from "./JobHistoryPanel";
import MeetingActionsPanel from "./MeetingActionsPanel";
import AiBidUsageCard from "./AiBidUsageCard";
import ProjectStatusStrip from "./ProjectStatusStrip";
import TabErrorBoundary from "./TabErrorBoundary";
import DailyBriefCard from "./DailyBriefCard";

export const dynamic = "force-dynamic";

// ── Status Timeline ───────────────────────────────────────────────────────────
const TIMELINE_STAGES = ["draft", "bidding", "awarded", "active", "closeout"] as const;
function BidStatusTimeline({ status }: { status: string }) {
  const activeIdx = TIMELINE_STAGES.indexOf(status as typeof TIMELINE_STAGES[number]);
  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto pb-1">
      {TIMELINE_STAGES.map((stage, i) => {
        const isPast = activeIdx > i;
        const isActive = activeIdx === i;
        const dotColor = isActive
          ? "var(--color-accent)"
          : isPast
          ? "var(--color-success)"
          : "rgba(255,255,255,0.12)";
        const textColor = isActive
          ? "var(--color-accent)"
          : isPast
          ? "var(--color-success)"
          : "rgba(255,255,255,0.25)";
        return (
          <div key={stage} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: dotColor, boxShadow: isActive ? `0 0 6px ${dotColor}` : "none" }}
              />
              <span className="text-[8px] font-mono uppercase tracking-[0.1em] whitespace-nowrap" style={{ color: textColor }}>
                {stage}
              </span>
            </div>
            {i < TIMELINE_STAGES.length - 1 && (
              <div
                className="flex-1 h-px mx-1.5"
                style={{ background: isPast ? "var(--color-success)" : "rgba(255,255,255,0.08)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

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

  const user = await getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/bids/${bidId}`)}`);

  const bid = await prisma.bid.findFirst({
    where: { id: bidId, ...bidScopeFilter(user) },
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

  const [overviewLevelingUploadCount, overviewHasBrief, overviewUnreviewedObs, overviewUncoveredSpecs] =
    tab === "overview"
      ? await Promise.all([
          prisma.estimateUpload.count({
            where: { bidId },
          }),
          prisma.bidIntelligenceBrief.findFirst({
            where: { bidId },
            select: { id: true },
          }).then(Boolean),
          prisma.consultantObservation.count({
            where: { bidId, state: "ENTERED" },
          }),
          prisma.specBook.findFirst({
            where: { bidId },
            orderBy: { uploadedAt: "desc" },
            select: { sections: { where: { covered: false }, select: { id: true } } },
          }).then((sb) => sb?.sections.length ?? 0),
        ])
      : [0, false, 0, 0];

  const overviewRespondedCount = bid.selections.filter((s) =>
    ["received", "reviewing", "accepted"].includes(s.rfqStatus)
  ).length;

  // ── Daily Brief card data (always fetched — card appears on all tabs) ────
  const [dailyBriefRecord, dailyBriefActionCount, dailyBriefDecisions] = await Promise.all([
    prisma.bidIntelligenceBrief.findUnique({
      where: { bidId },
      select: { riskFlags: true, status: true },
    }),
    prisma.meetingActionItem.count({
      where: { bidId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),
    prisma.bidDecision.findMany({
      where: { bidId, status: { not: "VOID" } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { category: true, decision: true },
    }),
  ]);

  // Parse risk flags from stored JSON; sort critical-first; cap at 3
  type ParsedFlag = { flag: string; severity: string };
  let dailyBriefFlags: ParsedFlag[] = [];
  if (dailyBriefRecord?.riskFlags) {
    try {
      const raw = JSON.parse(dailyBriefRecord.riskFlags);
      if (Array.isArray(raw)) {
        const SEV_ORDER: Record<string, number> = { critical: 0, moderate: 1, low: 2 };
        dailyBriefFlags = (raw as ParsedFlag[])
          .filter((f) => f.flag?.trim())
          .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
          .slice(0, 3);
      }
    } catch { /* malformed JSON — degrade gracefully */ }
  }

  // Server-render snapshot: all due-date cards in this response share one
  // clock value instead of sampling time independently during JSX render.
  // eslint-disable-next-line react-hooks/purity
  const overviewNow = Date.now();

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

      <DailyBriefCard
        bidId={bid.id}
        riskFlags={dailyBriefFlags}
        openActionItems={dailyBriefActionCount}
        decisions={dailyBriefDecisions}
      />

      <div className="px-6 py-6 min-w-0 flex-1">


          {tab === "overview" && (
            <TabErrorBoundary tabName="Overview">
              <div className="flex flex-col gap-5">

              {/* Status chips + Quick Push — most visible header position */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
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
                <QuickPushButton bidId={bid.id} />
              </div>

              {/* Status timeline */}
              <BidStatusTimeline status={bid.status} />

              {/* Market Intelligence provenance — renders only for promoted pursuits */}
              <PursuitOriginCard bidId={bid.id} />

              {/* Quick stats bar */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    label: "Open Action Items",
                    value: dailyBriefActionCount,
                    accent: dailyBriefActionCount > 0 ? "var(--color-warning)" : "var(--color-text-dim)",
                  },
                  {
                    label: "Unreviewed Reports",
                    value: overviewUnreviewedObs,
                    accent: overviewUnreviewedObs > 0 ? "var(--color-accent)" : "var(--color-text-dim)",
                  },
                  {
                    label: "Spec Gaps",
                    value: overviewUncoveredSpecs,
                    accent: overviewUncoveredSpecs > 0 ? "var(--color-warning)" : "var(--color-text-dim)",
                  },
                  {
                    label: "Days Until Due",
                    value: bid.dueDate
                      ? Math.max(0, Math.ceil((bid.dueDate.getTime() - overviewNow) / 86_400_000))
                      : "—",
                    accent: bid.dueDate && (bid.dueDate.getTime() - overviewNow) < 7 * 86_400_000
                      ? "var(--color-danger)"
                      : "var(--color-text-dim)",
                  },
                ].map(({ label, value, accent }) => (
                  <div
                    key={label}
                    className="rounded-lg border px-3 py-2.5"
                    style={{ background: "rgba(15,22,40,0.6)", borderColor: "var(--line)" }}
                  >
                    <p className="text-[9px] font-mono uppercase tracking-[0.08em] mb-1" style={{ color: "var(--color-text-dim)" }}>
                      {label}
                    </p>
                    <p className="text-[22px] font-[700] leading-none tabular-nums" style={{ color: accent }}>
                      {value}
                    </p>
                  </div>
                ))}
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
            </TabErrorBoundary>
          )}

          {tab === "trades" && (
            <TabErrorBoundary tabName="Trades">
              <TradesTab bidId={bid.id} bidTrades={bid.bidTrades} />
            </TabErrorBoundary>
          )}

          {tab === "subs" && (
            <TabErrorBoundary tabName="Subs">
              <SubsTab
                bidId={bid.id}
                initialSelections={bid.selections}
                bidTrades={bid.bidTrades}
                projectType={bid.projectType}
              />
            </TabErrorBoundary>
          )}

          {tab === "scope" && (
            <TabErrorBoundary tabName="Scope">
              <ScopeTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "decisions" && (
            <TabErrorBoundary tabName="Decisions">
              <DecisionLogTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "ai-review" && (
            <TabErrorBoundary tabName="Glint Review">
              <AiReviewTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "questions" && (
            <TabErrorBoundary tabName="Questions">
              <QuestionsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "leveling" && (
            <TabErrorBoundary tabName="Leveling">
              <LevelingTab bidId={bid.id} subs={levelingSubs} initialUploads={estimateUploads} />
            </TabErrorBoundary>
          )}
          {tab === "activity" && (
            <TabErrorBoundary tabName="Activity">
              <ActivityTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "documents" && (
            <TabErrorBoundary tabName="Documents">
              <DocumentsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "handoff" && (
            <TabErrorBoundary tabName="Handoff">
              <HandoffTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "submittals" && (
            <TabErrorBoundary tabName="Submittals">
              <SubmittalsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "schedule" && (
            <TabErrorBoundary tabName="Schedule">
              <ScheduleTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "meetings" && (
            <TabErrorBoundary tabName="Meetings">
              <MeetingsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "tasks" && (
            <TabErrorBoundary tabName="Tasks">
              <TasksTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "briefing" && (
            <TabErrorBoundary tabName="Briefing">
              <BriefingTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "procore" && (
            <TabErrorBoundary tabName="Procore">
              <ProcoreTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "operations" && (
            <TabErrorBoundary tabName="Operations">
              <OperationsRegisterTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "warranties" && (
            <TabErrorBoundary tabName="Warranties">
              <WarrantiesTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "training" && (
            <TabErrorBoundary tabName="Training">
              <TrainingTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "inspections" && (
            <TabErrorBoundary tabName="Inspections">
              <InspectionsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "spec-sections" && (
            <TabErrorBoundary tabName="Spec Sections">
              <SpecSectionsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "spec-requirements" && (
            <TabErrorBoundary tabName="Spec Requirements">
              <SpecRequirementsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "spec-addenda" && (
            <TabErrorBoundary tabName="Spec Addenda and Versions">
              <SpecVersionsTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
          {tab === "closeout" && (
            <TabErrorBoundary tabName="Closeout">
              <CloseoutTab bidId={bid.id} />
            </TabErrorBoundary>
          )}
      </div>
    </div>
  );
}
