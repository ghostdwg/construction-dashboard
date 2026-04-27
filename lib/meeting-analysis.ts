// ── Meeting Intelligence Analysis Contract ──────────────────────────────────
//
// Defines the 8-section analysis schema produced by Claude from a meeting
// transcript. This file is the single source of truth for:
//   - TypeScript types consumed by API routes and UI components
//   - The prompt builder that injects project context
//   - The response parser that validates Claude's JSON output
//   - The DB writer that commits a parsed analysis to Prisma

import { prisma } from "@/lib/prisma";

// ── Section types ─────────────────────────────────────────────────────────────

export type AnalysisSection1 = {
  date: string;          // ISO date "YYYY-MM-DD"
  projectName: string;
  durationMinutes: number | null;
};

export type AnalysisParticipant = {
  speakerId: string;     // "SPEAKER_A" | "ROOM_SPK_1" | participant name
  name: string;          // resolved name, or "[unclear]" if unknown
  role: string;          // job title / role
  company: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  isGcTeam: boolean;
  speakerType: "REMOTE" | "IN_ROOM" | "UNKNOWN";
};

export type AnalysisActionItem = {
  person: string;        // assignee name
  task: string;          // paraphrased task description
  dueDate: string | null; // "YYYY-MM-DD" or null
  isGcTask: boolean;
  carriedFromDate: string | null; // ISO date of originating meeting, or null
  evidenceText: string | null;   // paraphrased transcript excerpt
};

export type MeetingOpenIssue = {
  text: string;
  reason: string;
  carriedFrom: string | null; // ISO date of meeting where it first appeared
};

export type RedFlagTag = "DELAY" | "COST" | "RISK" | "DISPUTE" | "SAFETY" | "COMPLIANCE";

export type MeetingRedFlag = {
  tag: RedFlagTag;
  description: string;
};

export type MeetingAnalysis = {
  section1: AnalysisSection1;
  section2: AnalysisParticipant[];          // Who was in the meeting
  section3: string;                          // Meeting overview (2–3 sentences)
  section4: string[];                        // Key decisions — finalized items only
  section5: AnalysisActionItem[];            // All action items
  section6: MeetingOpenIssue[];             // Open / unresolved issues
  section7: MeetingRedFlag[];               // Red flags
  section8: AnalysisActionItem[];           // GC-only subset of §5
};

// ── Project context assembly ──────────────────────────────────────────────────
//
// Gathers live project state that the sidecar injects into the Claude prompt
// so Claude can cross-reference meeting discussions against open RFIs,
// overdue submittals, and unresolved action items.

export type ProjectContextPayload = {
  openRfis: Array<{ number: string; title: string; status: string; dueDate: string | null }>;
  overdueSubmittals: Array<{ specSection: string; title: string; dueDate: string }>;
  openTasks: Array<{ assignedTo: string; description: string; dueDate: string | null }>;
};

export async function getProjectContext(bidId: number): Promise<ProjectContextPayload> {
  const now = new Date();

  const [rfis, submittals, tasks] = await Promise.all([
    prisma.rfiItem.findMany({
      where: { bidId, status: { not: "closed" } },
      select: { number: true, title: true, status: true, dueDate: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.submittalItem.findMany({
      where: {
        bidId,
        status: { notIn: ["APPROVED", "CLOSED"] },
        OR: [
          { requiredBy: { lt: now } },
          { submitByDate: { lt: now } },
        ],
      },
      select: {
        title: true,
        requiredBy: true,
        submitByDate: true,
        specSection: { select: { csiNumber: true } },
      },
      orderBy: { submitByDate: "asc" },
      take: 20,
    }),
    prisma.meetingActionItem.findMany({
      where: { bidId, status: "OPEN" },
      select: { assignedToName: true, description: true, dueDate: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    openRfis: rfis.map((r) => ({
      number: r.number,
      title: r.title,
      status: r.status,
      dueDate: r.dueDate ? r.dueDate.toISOString().split("T")[0] : null,
    })),
    overdueSubmittals: submittals.map((s) => ({
      specSection: s.specSection?.csiNumber ?? "",
      title: s.title,
      dueDate: (s.submitByDate ?? s.requiredBy)!.toISOString().split("T")[0],
    })),
    openTasks: tasks.map((t) => ({
      assignedTo: t.assignedToName ?? "Unassigned",
      description: t.description,
      dueDate: t.dueDate ? t.dueDate.toISOString().split("T")[0] : null,
    })),
  };
}

// ── Prior open items auto-fetch ───────────────────────────────────────────────
//
// Looks up the most recent prior analyzed meeting on the same project,
// reads its openIssues JSON, and returns a formatted string ready for
// prompt injection. Eliminates the need for the caller to manually paste
// section 6 from the previous meeting.

export async function getPriorOpenItems(
  meetingId: number,
  bidId: number,
): Promise<string> {
  // Get the current meeting's date so we only look backwards
  const current = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { meetingDate: true },
  });
  if (!current) return "none";

  const prior = await prisma.meeting.findFirst({
    where: {
      bidId,
      id: { not: meetingId },
      meetingDate: { lt: current.meetingDate },
      analyzedAt: { not: null },
    },
    orderBy: { meetingDate: "desc" },
    select: { openIssues: true, meetingDate: true, title: true },
  });

  if (!prior) return "none";

  let issues: MeetingOpenIssue[] = [];
  try {
    const parsed = JSON.parse(prior.openIssues);
    if (Array.isArray(parsed)) issues = parsed as MeetingOpenIssue[];
  } catch {
    return "none";
  }

  if (issues.length === 0) return "none";

  const dateStr = new Date(prior.meetingDate).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return issues
    .map((i, n) => `${n + 1}. ${i.text} — ${i.reason} (from ${dateStr}: ${prior.title})`)
    .join("\n");
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export type AnalysisPromptContext = {
  transcript: string;
  projectName: string;
  speakerRoster?: string;      // pre-resolved speaker list, or ""
  knownVoiceSplits?: string;   // confirmed speaker splits, or ""
  priorOpenItems?: string;     // §6 JSON from prior meeting, stringified, or ""
  gcTeamMembers?: string[];    // names of GC team members for bolding
  mode?: "full" | "actions_only" | "flags_only";
};

export function buildAnalysisPrompt(ctx: AnalysisPromptContext): string {
  const mode = ctx.mode ?? "full";
  const sections = mode === "actions_only"
    ? "sections 5 and 8 only"
    : mode === "flags_only"
    ? "section 7 only"
    : "all 8 sections";

  const gcTeamLine = ctx.gcTeamMembers?.length
    ? `GC team members (mark isGcTeam: true): ${ctx.gcTeamMembers.join(", ")}`
    : "GC team members: not specified — use role and company context to infer";

  return `You are a construction project meeting analyst for a commercial GC.

Analyze the transcript below and return a JSON object containing ${sections}.
Return ONLY valid JSON — no markdown fences, no commentary outside the JSON.

The JSON must match this exact schema:
{
  "section1": { "date": "YYYY-MM-DD", "projectName": "string", "durationMinutes": number | null },
  "section2": [{ "speakerId": "string", "name": "string", "role": "string", "company": "string|null", "confidence": "HIGH|MEDIUM|LOW", "isGcTeam": boolean, "speakerType": "REMOTE|IN_ROOM|UNKNOWN" }],
  "section3": "2–3 sentence overview string",
  "section4": ["decision string", ...],
  "section5": [{ "person": "string", "task": "string", "dueDate": "YYYY-MM-DD|null", "isGcTask": boolean, "carriedFromDate": "YYYY-MM-DD|null", "evidenceText": "string|null" }],
  "section6": [{ "text": "string", "reason": "string", "carriedFrom": "YYYY-MM-DD|null" }],
  "section7": [{ "tag": "DELAY|COST|RISK|DISPUTE|SAFETY|COMPLIANCE", "description": "string" }],
  "section8": [same shape as section5, GC tasks only]
}

Rules:
- Ignore all [UNKNOWN] speaker lines
- Ignore filler lines (Yeah. / Okay. / Right. / Sure. / Uh-huh.)
- Do not quote transcript text verbatim — paraphrase everything in evidenceText
- Do not invent content — use "[unclear]" for ambiguous items
- section8 is a filtered subset of section5 where isGcTask is true
- Items in section4 must NOT appear in section6
- Flag items carried from prior meetings with the originating date in carriedFromDate / carriedFrom

${gcTeamLine}

Speaker roster: ${ctx.speakerRoster || "not provided"}
Known voice splits: ${ctx.knownVoiceSplits || "none"}
Prior open items (section 6 from last meeting): ${ctx.priorOpenItems || "none"}

Transcript:
${ctx.transcript}`;
}

// ── Parser ────────────────────────────────────────────────────────────────────

const VALID_TAGS = new Set<RedFlagTag>(["DELAY", "COST", "RISK", "DISPUTE", "SAFETY", "COMPLIANCE"]);
const VALID_CONFIDENCE = new Set(["HIGH", "MEDIUM", "LOW"]);
const VALID_SPEAKER_TYPE = new Set(["REMOTE", "IN_ROOM", "UNKNOWN"]);

export function parseMeetingAnalysis(raw: string): MeetingAnalysis {
  let parsed: unknown;
  try {
    // Strip accidental markdown fences if Claude adds them
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Meeting analysis response is not valid JSON. Raw starts with: ${raw.slice(0, 120)}`);
  }

  const obj = parsed as Record<string, unknown>;

  const s1 = (obj.section1 ?? {}) as Record<string, unknown>;
  const section1: AnalysisSection1 = {
    date: String(s1.date ?? ""),
    projectName: String(s1.projectName ?? ""),
    durationMinutes: typeof s1.durationMinutes === "number" ? s1.durationMinutes : null,
  };

  const section2: AnalysisParticipant[] = (Array.isArray(obj.section2) ? obj.section2 : []).map((p: unknown) => {
    const r = p as Record<string, unknown>;
    const conf = String(r.confidence ?? "").toUpperCase();
    const stype = String(r.speakerType ?? "").toUpperCase();
    return {
      speakerId: String(r.speakerId ?? ""),
      name: String(r.name ?? ""),
      role: String(r.role ?? ""),
      company: r.company != null ? String(r.company) : null,
      confidence: VALID_CONFIDENCE.has(conf) ? (conf as "HIGH" | "MEDIUM" | "LOW") : "LOW",
      isGcTeam: Boolean(r.isGcTeam),
      speakerType: VALID_SPEAKER_TYPE.has(stype) ? (stype as "REMOTE" | "IN_ROOM" | "UNKNOWN") : "UNKNOWN",
    };
  });

  const section3 = String(obj.section3 ?? "");

  const section4: string[] = (Array.isArray(obj.section4) ? obj.section4 : []).map((d: unknown) => String(d));

  const mapActionItem = (a: unknown): AnalysisActionItem => {
    const r = a as Record<string, unknown>;
    return {
      person: String(r.person ?? ""),
      task: String(r.task ?? ""),
      dueDate: r.dueDate != null && r.dueDate !== "null" ? String(r.dueDate) : null,
      isGcTask: Boolean(r.isGcTask),
      carriedFromDate: r.carriedFromDate != null && r.carriedFromDate !== "null" ? String(r.carriedFromDate) : null,
      evidenceText: r.evidenceText != null && r.evidenceText !== "null" ? String(r.evidenceText) : null,
    };
  };

  const section5: AnalysisActionItem[] = (Array.isArray(obj.section5) ? obj.section5 : []).map(mapActionItem);

  const section6: MeetingOpenIssue[] = (Array.isArray(obj.section6) ? obj.section6 : []).map((i: unknown) => {
    const r = i as Record<string, unknown>;
    return {
      text: String(r.text ?? ""),
      reason: String(r.reason ?? ""),
      carriedFrom: r.carriedFrom != null && r.carriedFrom !== "null" ? String(r.carriedFrom) : null,
    };
  });

  const section7: MeetingRedFlag[] = (Array.isArray(obj.section7) ? obj.section7 : []).map((f: unknown) => {
    const r = f as Record<string, unknown>;
    const tag = String(r.tag ?? "").toUpperCase() as RedFlagTag;
    return {
      tag: VALID_TAGS.has(tag) ? tag : "RISK",
      description: String(r.description ?? ""),
    };
  });

  const section8: AnalysisActionItem[] = (Array.isArray(obj.section8) ? obj.section8 : []).map(mapActionItem);

  return { section1, section2, section3, section4, section5, section6, section7, section8 };
}

// ── DB writer ─────────────────────────────────────────────────────────────────

export async function writeMeetingAnalysis(
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis,
): Promise<void> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // §3 overview + §4 decisions + §6 open issues + §7 red flags + version bump
    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        summary: analysis.section3,
        keyDecisions: JSON.stringify(analysis.section4),
        openIssues: JSON.stringify(analysis.section6),
        redFlags: JSON.stringify(analysis.section7),
        reviewStatus: "DRAFT",
        analyzedAt: now,
        analysisVersion: { increment: 1 },
      },
    });

    // §2 participants — upsert by speakerLabel within this meeting
    for (const p of analysis.section2) {
      const existing = await tx.meetingParticipant.findFirst({
        where: { meetingId, speakerLabel: p.speakerId },
      });
      if (existing) {
        await tx.meetingParticipant.update({
          where: { id: existing.id },
          data: {
            name: p.name,
            role: p.role ?? existing.role,
            company: p.company ?? existing.company,
            confidence: p.confidence === "HIGH" ? 0.9 : p.confidence === "MEDIUM" ? 0.6 : 0.3,
            speakerType: p.speakerType,
            isGcTeam: p.isGcTeam,
          },
        });
      } else {
        await tx.meetingParticipant.create({
          data: {
            meetingId,
            name: p.name,
            role: p.role,
            company: p.company,
            speakerLabel: p.speakerId,
            speakerType: p.speakerType,
            confidence: p.confidence === "HIGH" ? 0.9 : p.confidence === "MEDIUM" ? 0.6 : 0.3,
            isGcTeam: p.isGcTeam,
          },
        });
      }
    }

    // §5 action items — delete prior AI-generated items, insert fresh
    // (manual items preserved by not touching rows where sourceText is null and createdAt predates analysis)
    await tx.meetingActionItem.deleteMany({
      where: { meetingId, sourceText: { not: null } },
    });

    for (const item of analysis.section5) {
      // Resolve participant ID from name if possible
      const participant = await tx.meetingParticipant.findFirst({
        where: { meetingId, name: item.person },
      });
      await tx.meetingActionItem.create({
        data: {
          bidId,
          meetingId,
          description: item.task,
          assignedToId: participant?.id ?? null,
          assignedToName: item.person,
          dueDate: item.dueDate ? new Date(item.dueDate) : null,
          sourceText: item.evidenceText,
          isGcTask: item.isGcTask,
          carriedFromDate: item.carriedFromDate,
          priority: "MEDIUM",
          status: "OPEN",
        },
      });
    }
  });
}
