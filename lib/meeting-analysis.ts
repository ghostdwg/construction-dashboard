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

export type DesignChangeSeverity = "CRITICAL" | "MAJOR" | "MINOR";

// OPS5 — a proposed design intent change extracted from the transcript.
// PROPOSAL-ONLY: rows land as PROPOSED; confirmation/dismissal is human.
export type AnalysisDesignChange = {
  changeText: string;              // what is changing (≤2000)
  priorIntent: string | null;      // prior approved intent, from the transcript only
  affectedSpec: string | null;     // spec/drawing ref, verbatim words if stated (≤200)
  severity: DesignChangeSeverity;
  sourceQuote: string | null;      // verbatim excerpt ≤300 — the deliberate exception to the paraphrase rule
  speakerLabel: string | null;     // draft attribution, never verified identity
};

// OPS7 — a proposed verbal commitment extracted from the transcript.
export type AnalysisCommitment = {
  committedBy: string;         // resolved name — draft attribution
  speakerLabel: string | null;
  commitmentText: string;      // ≤2000
  duePhrase: string | null;    // verbatim date words
  dueDate: string | null;      // ISO date, only when unambiguous
  sourceQuote: string | null;  // verbatim ≤300 — paraphrase-rule exception
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
  section9: AnalysisDesignChange[];         // OPS5 — design intent changes
  section10: AnalysisCommitment[];          // OPS7 — verbal commitments
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

// ── Outstanding commitments (OPS7 cross-meeting carry) ───────────────────────
//
// Confirmed-OPEN commitments from OTHER meetings on this bid, formatted for
// prompt-context injection so follow-through gets discussed. Context only —
// nothing here mutates commitment rows.

export async function getOutstandingCommitments(
  meetingId: number,
  bidId: number,
): Promise<string> {
  const rows = await prisma.meetingCommitment.findMany({
    where: { bidId, status: "OPEN", meetingId: { not: meetingId } },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: 20,
    select: { committedBy: true, commitmentText: true, dueDate: true, duePhrase: true },
  });
  if (rows.length === 0) return "none";
  return rows
    .map((c, n) => {
      const due = c.dueDate
        ? ` [due ${c.dueDate.toISOString().split("T")[0]}]`
        : c.duePhrase
          ? ` [due "${c.duePhrase}"]`
          : "";
      return `${n + 1}. ${c.committedBy}: ${c.commitmentText}${due}`;
    })
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
  "section8": [same shape as section5, GC tasks only],
  "section9": [{ "change_text": "string", "prior_intent": "string|null", "affected_spec": "string|null", "severity": "CRITICAL|MAJOR|MINOR", "source_quote": "string|null", "speaker_label": "string|null" }],
  "section10": [{ "committed_by": "string", "speaker_label": "string|null", "commitment_text": "string", "due_phrase": "string|null", "normalized_due": "YYYY-MM-DD|null", "source_quote": "string|null" }]
}

Rules:
- Ignore all [UNKNOWN] speaker lines
- Ignore filler lines (Yeah. / Okay. / Right. / Sure. / Uh-huh.)
- Do not quote transcript text verbatim — paraphrase everything in evidenceText
  (EXCEPTION: section9's source_quote is a bounded verbatim excerpt by design)
- Do not invent content — use "[unclear]" for ambiguous items
- section8 is a filtered subset of section5 where isGcTask is true
- Items in section4 must NOT appear in section6
- Flag items carried from prior meetings with the originating date in carriedFromDate / carriedFrom
- Section 9 (design intent changes): extract ONLY explicit direction from a
  design professional or owner that changes the documented or previously
  approved design (spec override, reversed decision, "in lieu of", "revise
  to", verbal ASI-style instruction). Discussion, options, and questions
  are NOT design changes; site condition reports are NOT design changes.
  severity: CRITICAL = life-safety/structural or contract-document
  conflict; MAJOR = changes scope, cost, or an approved submittal; MINOR =
  finish/detail-level direction. source_quote: verbatim excerpt, max 300
  chars. Never invent spec or drawing references. Empty array when none.
- Section 10 (commitments): extract explicit verbal commitments only — a
  person committing themselves/their company ("we will have X done by
  Friday") or clearly acknowledging an assignment. due_phrase = verbatim
  date words; normalized_due = ISO date ONLY when unambiguous relative to
  the meeting date — never invent. source_quote verbatim, max 300 chars.
  Exclude hopes/estimates, unanswered requests, options, and third-party
  hearsay; skip anything already emitted as a section5 action item for
  the same person and task. Empty array when none.

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

  // OPS5 §9 — design intent changes. Invalid rows are DROPPED (never
  // repaired into fabrications); fields are clamped, severity is
  // vocabulary-enforced with MAJOR as the conservative fallback.
  const VALID_SEVERITIES = new Set<DesignChangeSeverity>(["CRITICAL", "MAJOR", "MINOR"]);
  const clamp = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const section9: AnalysisDesignChange[] = (Array.isArray(obj.section9) ? obj.section9 : [])
    .map((c: unknown): AnalysisDesignChange | null => {
      const r = c as Record<string, unknown>;
      const changeText = clamp(r.change_text, 2000);
      if (!changeText) return null;
      const severityRaw = String(r.severity ?? "").toUpperCase() as DesignChangeSeverity;
      return {
        changeText,
        priorIntent: clamp(r.prior_intent, 2000),
        affectedSpec: clamp(r.affected_spec, 200),
        severity: VALID_SEVERITIES.has(severityRaw) ? severityRaw : "MAJOR",
        sourceQuote: clamp(r.source_quote, 300),
        speakerLabel: clamp(r.speaker_label, 100),
      };
    })
    .filter((c): c is AnalysisDesignChange => c !== null);

  // OPS7 §10 — commitments. Invalid rows DROPPED; fields clamped; dates
  // must be strict ISO or null (never repaired into guesses).
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const section10: AnalysisCommitment[] = (Array.isArray(obj.section10) ? obj.section10 : [])
    .map((c: unknown): AnalysisCommitment | null => {
      const r = c as Record<string, unknown>;
      const committedBy = clamp(r.committed_by, 200);
      const commitmentText = clamp(r.commitment_text, 2000);
      if (!committedBy || !commitmentText) return null;
      const due = typeof r.normalized_due === "string" && ISO_DATE.test(r.normalized_due)
        ? r.normalized_due
        : null;
      return {
        committedBy,
        speakerLabel: clamp(r.speaker_label, 100),
        commitmentText,
        duePhrase: clamp(r.due_phrase, 120),
        dueDate: due,
        sourceQuote: clamp(r.source_quote, 300),
      };
    })
    .filter((c): c is AnalysisCommitment => c !== null);

  return { section1, section2, section3, section4, section5, section6, section7, section8, section9, section10 };
}

// ── DB writer ─────────────────────────────────────────────────────────────────

// R2-B1 — the writer reports the ids of the rows it (re)created, in the
// same order as the analysis arrays, so the Meeting Register projection can
// bridge entries to their lifecycle rows without re-querying by text.
export type WriteMeetingAnalysisResult = {
  actionItemIds: number[];      // §5 order
  commitmentIds: number[];      // §10 order
  designChangeIds: number[];    // §9 order
};

// Prisma interactive-transaction client shape (subset used here).
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function writeMeetingAnalysis(
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis,
): Promise<WriteMeetingAnalysisResult> {
  return prisma.$transaction((tx) =>
    writeMeetingAnalysisTx(tx, meetingId, bidId, analysis)
  );
}

// Transaction-scoped variant so callers (extraction-run apply) can compose
// the analysis write with register-projection writes atomically.
export async function writeMeetingAnalysisTx(
  tx: PrismaTx,
  meetingId: number,
  bidId: number,
  analysis: MeetingAnalysis,
): Promise<WriteMeetingAnalysisResult> {
  const now = new Date();
  const result: WriteMeetingAnalysisResult = {
    actionItemIds: [],
    commitmentIds: [],
    designChangeIds: [],
  };
  {
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

    // §2 participants — upsert active identities only. A merged source row
    // is durable provenance and must never be silently reactivated by rerun.
    for (const p of analysis.section2) {
      const existing = await tx.meetingParticipant.findFirst({
        where: { meetingId, speakerLabel: p.speakerId, isActive: true },
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

    // §9 design intent changes — replace PROPOSED rows only. CONFIRMED and
    // DISMISSED rows are human decisions and are NEVER touched by
    // re-analysis (OPS5 freeze discipline).
    await tx.designIntentChange.deleteMany({
      where: { meetingId, state: "PROPOSED" },
    });
    for (const change of analysis.section9) {
      const createdChange = await tx.designIntentChange.create({
        data: {
          meetingId,
          bidId,
          changeText: change.changeText,
          priorIntent: change.priorIntent,
          affectedSpec: change.affectedSpec,
          severity: change.severity,
          sourceQuote: change.sourceQuote,
          speakerLabel: change.speakerLabel,
          // state stays the PROPOSED default — confirmation is human-only.
        },
      });
      result.designChangeIds.push(createdChange.id);
    }

    // §10 commitments — replace PROPOSED rows only. OPEN/FULFILLED/
    // DISMISSED are human decisions and are NEVER touched by re-analysis.
    await tx.meetingCommitment.deleteMany({
      where: { meetingId, status: "PROPOSED" },
    });
    for (const commitment of analysis.section10) {
      const createdCommitment = await tx.meetingCommitment.create({
        data: {
          meetingId,
          bidId,
          committedBy: commitment.committedBy,
          speakerLabel: commitment.speakerLabel,
          commitmentText: commitment.commitmentText,
          duePhrase: commitment.duePhrase,
          dueDate: commitment.dueDate ? new Date(`${commitment.dueDate}T00:00:00.000Z`) : null,
          sourceQuote: commitment.sourceQuote,
          // status stays the PROPOSED default — confirmation is human-only.
        },
      });
      result.commitmentIds.push(createdCommitment.id);
    }

    // §5 action items — non-destructive exact reconciliation. Human-advanced
    // OPEN/CLOSED/DEFERRED and promoted rows retain identity, status and all
    // source links. Only genuinely new canonical items are inserted; an AI
    // rerun never deletes or rewrites an existing action-item row.
    const existingActionItems = await tx.meetingActionItem.findMany({
      // Evidence text is optional in the frozen analysis contract. Include
      // every meeting-owned row so an unquoted action can still retain its
      // identity and human lifecycle state on a later extraction.
      where: { meetingId },
      orderBy: { id: "asc" },
    });
    const reusedActionItemIds = new Set<number>();
    const canonical = (value: string | null | undefined) =>
      (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

    for (const item of analysis.section5) {
      const exact = existingActionItems.find(
        (row) =>
          !reusedActionItemIds.has(row.id) &&
          canonical(row.description) === canonical(item.task) &&
          canonical(row.sourceText) === canonical(item.evidenceText) &&
          canonical(row.assignedToName) === canonical(item.person),
      );
      if (exact) {
        reusedActionItemIds.add(exact.id);
        result.actionItemIds.push(exact.id);
        continue;
      }
      // Resolve participant ID from name if possible
      const participant = await tx.meetingParticipant.findFirst({
        where: { meetingId, name: item.person, isActive: true },
      });
      const createdItem = await tx.meetingActionItem.create({
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
          source: "meeting",
        },
      });
      result.actionItemIds.push(createdItem.id);
    }
  }
  return result;
}
