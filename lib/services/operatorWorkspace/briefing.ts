// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/briefing.ts
//  Phase MI-10 — Operator briefing generation.
//
//  Generates structured briefings from existing intelligence tables. The
//  output is operator-facing markdown-ish prose plus structured payload
//  rows for the UI to render evidence drilldowns.
//
//  Six briefing kinds:
//    CORRIDOR_SUMMARY     — one corridor, window-N-days summary
//    WEEKLY_EMERGENCE     — week-over-week emergence report
//    JURISDICTION_HEAT    — jurisdiction-level cadence + projects
//    DEVELOPER_MOVEMENT   — developer-level momentum + new attachments
//    FORECAST_CHANGE      — biggest probability movers in a window
//    CUSTOM               — operator-supplied (PR-1 returns a stub)
//
//  Pure data assembly — no LLM, no narrative invention. Every claim points
//  to a row in the database.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitWorkspaceAudit } from "./audit";
import {
  type BriefingGeneratorInput,
  type BriefingGeneratorResult,
  type BriefingGeneratorSection,
  type BriefingKind,
  WORKSPACE_VERSION,
} from "./types";

export async function generateBriefing(input: BriefingGeneratorInput): Promise<BriefingGeneratorResult> {
  switch (input.briefingKind) {
    case "CORRIDOR_SUMMARY":    return generateCorridorSummary(input);
    case "WEEKLY_EMERGENCE":    return generateWeeklyEmergence(input);
    case "JURISDICTION_HEAT":   return generateJurisdictionHeat(input);
    case "DEVELOPER_MOVEMENT":  return generateDeveloperMovement(input);
    case "FORECAST_CHANGE":     return generateForecastChange(input);
    case "CUSTOM":              return generateCustomStub(input);
  }
}

async function generateCorridorSummary(input: BriefingGeneratorInput): Promise<BriefingGeneratorResult> {
  if (!input.corridorKey) {
    return errorBriefing(input.briefingKind, "corridorKey is required for CORRIDOR_SUMMARY");
  }
  const corridor = await prisma.corridorHeat.findUnique({ where: { corridorKey: input.corridorKey } });
  if (!corridor) {
    return errorBriefing(input.briefingKind, `corridor not found: ${input.corridorKey}`);
  }
  const sections: BriefingGeneratorSection[] = [
    {
      position: 0,
      sectionKind: "HEADLINE",
      title: null,
      body: `${corridor.corridorLabel} — heat ${corridor.heatScore.toFixed(2)} (${corridor.classification})`,
    },
    {
      position: 1,
      sectionKind: "KEY_FINDINGS",
      title: "Key findings",
      body: [
        `- Heat score: **${corridor.heatScore.toFixed(2)}** (${corridor.classification})`,
        `- Acceleration: **${corridor.acceleration.toFixed(2)}**`,
        `- Mean parcel pressure: **${corridor.meanPressure.toFixed(2)}**`,
        `- Active members in last 90d: **${corridor.activeMembers}**`,
      ].join("\n"),
    },
    {
      position: 2,
      sectionKind: "CORRIDOR_BLOCK",
      title: "Corridor evidence",
      body: `${corridor.memberParcelIds.split(",").length} member parcels${corridor.memberSetTruncated ? " (truncated)" : ""}`,
      payload: {
        corridorKey: corridor.corridorKey,
        members: corridor.memberParcelIds.split(",").filter((s) => s.length > 0),
        classification: corridor.classification,
        heatScore: corridor.heatScore,
        acceleration: corridor.acceleration,
      },
    },
  ];

  return {
    briefingKind: input.briefingKind,
    title: input.title ?? `Corridor: ${corridor.corridorLabel}`,
    summary: `${corridor.corridorLabel} is currently classified ${corridor.classification} with heat score ${corridor.heatScore.toFixed(2)} and acceleration ${corridor.acceleration.toFixed(2)}.`,
    sections,
    reasonLog: [
      `corridorKey=${corridor.corridorKey}`,
      `classification=${corridor.classification}`,
    ],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

async function generateWeeklyEmergence(input: BriefingGeneratorInput): Promise<BriefingGeneratorResult> {
  const cutoff = input.windowStart;
  const top = await prisma.emergenceScore.findMany({
    where: { latestComputedAt: { gte: cutoff } },
    orderBy: { score: "desc" },
    take: 20,
  });

  const sections: BriefingGeneratorSection[] = [];
  sections.push({
    position: 0,
    sectionKind: "HEADLINE",
    title: null,
    body: `Top ${top.length} emerging subjects, ${input.windowStart.toISOString().slice(0, 10)} → ${input.windowEnd.toISOString().slice(0, 10)}`,
  });
  sections.push({
    position: 1,
    sectionKind: "KEY_FINDINGS",
    title: "Top emerging subjects",
    body: top.map((r, i) =>
      `${i + 1}. **${r.subjectKind}/${r.subjectId.slice(0, 8)}** — score ${r.score.toFixed(2)} (${r.confidence})`
    ).join("\n"),
    payload: { items: top },
  });

  const trajectoryShifts = await prisma.emergenceTrajectory.findMany({
    where: { shiftDetected: true, updatedAt: { gte: cutoff } },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });
  if (trajectoryShifts.length > 0) {
    sections.push({
      position: 2,
      sectionKind: "FORECAST_BLOCK",
      title: "Trajectory shifts this window",
      body: trajectoryShifts.map((t) =>
        `- **${t.subjectKind}/${t.subjectId.slice(0, 8)}** entered ${t.state} (was ${t.previousState ?? "—"}); reason: ${t.shiftReason ?? "unspecified"}`
      ).join("\n"),
      payload: { shifts: trajectoryShifts },
    });
  }

  return {
    briefingKind: input.briefingKind,
    title: input.title ?? `Weekly emergence ${input.windowStart.toISOString().slice(0, 10)}`,
    summary: `${top.length} subjects emerging; ${trajectoryShifts.length} trajectory shifts detected.`,
    sections,
    reasonLog: [
      `top_count=${top.length}`,
      `shifts=${trajectoryShifts.length}`,
    ],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

async function generateJurisdictionHeat(input: BriefingGeneratorInput): Promise<BriefingGeneratorResult> {
  if (!input.jurisdictionKey) {
    return errorBriefing(input.briefingKind, "jurisdictionKey is required");
  }
  const row = await prisma.jurisdictionVelocity.findUnique({ where: { jurisdictionKey: input.jurisdictionKey } });
  if (!row) {
    return errorBriefing(input.briefingKind, `jurisdiction not found: ${input.jurisdictionKey}`);
  }

  const sections: BriefingGeneratorSection[] = [
    {
      position: 0,
      sectionKind: "HEADLINE",
      title: null,
      body: `${row.jurisdictionLabel} — cadence ${row.cadenceClass}, velocity ${row.velocityScore.toFixed(2)}`,
    },
    {
      position: 1,
      sectionKind: "KEY_FINDINGS",
      title: "Cadence summary",
      body: [
        `- Cadence class: **${row.cadenceClass}**`,
        `- Velocity score: **${row.velocityScore.toFixed(2)}**`,
        `- Acceleration: **${row.acceleration.toFixed(2)}**`,
        `- New projects 30d / 90d / 365d: **${row.newProjectsLast30d} / ${row.newProjectsLast90d} / ${row.newProjectsLast365d}**`,
        `- New signals 30d / 90d: **${row.newSignalsLast30d} / ${row.newSignalsLast90d}**`,
      ].join("\n"),
    },
    {
      position: 2,
      sectionKind: "JURISDICTION_BLOCK",
      title: "Jurisdiction evidence",
      body: `Velocity recorded at ${row.computedAt.toISOString()}.`,
      payload: row,
    },
  ];

  return {
    briefingKind: input.briefingKind,
    title: input.title ?? `Jurisdiction heat: ${row.jurisdictionLabel}`,
    summary: `${row.jurisdictionLabel} cadence is ${row.cadenceClass}, velocity ${row.velocityScore.toFixed(2)}.`,
    sections,
    reasonLog: [
      `jurisdictionKey=${row.jurisdictionKey}`,
      `cadenceClass=${row.cadenceClass}`,
    ],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

async function generateDeveloperMovement(input: BriefingGeneratorInput): Promise<BriefingGeneratorResult> {
  const top = await prisma.developmentMomentum.findMany({
    where: { classification: { in: ["ACCELERATING", "SUSTAINED"] } },
    orderBy: { momentumScore: "desc" },
    take: 25,
  });
  const sections: BriefingGeneratorSection[] = [];
  sections.push({
    position: 0,
    sectionKind: "HEADLINE",
    title: null,
    body: `${top.length} developers showing accelerating or sustained momentum`,
  });
  sections.push({
    position: 1,
    sectionKind: "DEVELOPER_BLOCK",
    title: "Developer momentum",
    body: top.map((r, i) =>
      `${i + 1}. **${r.developerNameCache ?? r.developerEntityId.slice(0, 8)}** — momentum ${r.momentumScore.toFixed(2)} (${r.classification}); new projects 30d=${r.newProjectsLast30d}, parcels 90d=${r.newParcelsLast90d}`
    ).join("\n"),
    payload: { items: top },
  });
  return {
    briefingKind: input.briefingKind,
    title: input.title ?? "Developer movement",
    summary: `${top.length} developers tracked.`,
    sections,
    reasonLog: [`top_count=${top.length}`],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

async function generateForecastChange(input: BriefingGeneratorInput): Promise<BriefingGeneratorResult> {
  const cutoff = input.windowStart;
  const movers = await prisma.probabilityTrend.findMany({
    where: { recordedAt: { gte: cutoff }, direction: { in: ["UP", "DOWN"] } },
    orderBy: { delta: "desc" },
    take: 25,
  });
  const ups = movers.filter((m) => m.delta > 0);
  const downs = movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta);

  const sections: BriefingGeneratorSection[] = [];
  sections.push({
    position: 0,
    sectionKind: "HEADLINE",
    title: null,
    body: `${ups.length} biggest gainers, ${downs.length} biggest droppers since ${input.windowStart.toISOString().slice(0, 10)}`,
  });
  sections.push({
    position: 1,
    sectionKind: "FORECAST_BLOCK",
    title: "Biggest gainers",
    body: ups.slice(0, 10).map((m, i) =>
      `${i + 1}. **${m.subjectKind}/${m.subjectId.slice(0, 8)}** — Δ ${m.delta.toFixed(2)} (${m.previousScore.toFixed(2)} → ${m.currentScore.toFixed(2)})`
    ).join("\n"),
    payload: { ups: ups.slice(0, 10) },
  });
  sections.push({
    position: 2,
    sectionKind: "FORECAST_BLOCK",
    title: "Biggest droppers",
    body: downs.slice(0, 10).map((m, i) =>
      `${i + 1}. **${m.subjectKind}/${m.subjectId.slice(0, 8)}** — Δ ${m.delta.toFixed(2)} (${m.previousScore.toFixed(2)} → ${m.currentScore.toFixed(2)})`
    ).join("\n"),
    payload: { downs: downs.slice(0, 10) },
  });

  return {
    briefingKind: input.briefingKind,
    title: input.title ?? `Forecast change ${input.windowStart.toISOString().slice(0, 10)}`,
    summary: `${ups.length + downs.length} significant probability movers this window.`,
    sections,
    reasonLog: [`ups=${ups.length}`, `downs=${downs.length}`],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

function generateCustomStub(input: BriefingGeneratorInput): BriefingGeneratorResult {
  return {
    briefingKind: input.briefingKind,
    title: input.title ?? "Custom briefing",
    summary: "Custom briefing kind — operator-defined content required.",
    sections: [{
      position: 0,
      sectionKind: "NOTE_BLOCK",
      title: null,
      body: "CUSTOM briefings are operator-authored. PR-1 ships a placeholder.",
    }],
    reasonLog: ["custom_pr1_placeholder"],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

function errorBriefing(kind: BriefingKind, reason: string): BriefingGeneratorResult {
  return {
    briefingKind: kind,
    title: `Error: ${kind}`,
    summary: reason,
    sections: [{
      position: 0,
      sectionKind: "NOTE_BLOCK",
      title: "Error",
      body: reason,
    }],
    reasonLog: [`error: ${reason}`],
    workspaceVersion: WORKSPACE_VERSION,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface PersistBriefingInput {
  generated: BriefingGeneratorResult;
  windowStart: Date;
  windowEnd: Date;
  jurisdictionKey?: string;
  corridorKey?: string;
  watchlistId?: string;
  actor?: { userId: string | null; email: string | null };
  publishImmediately?: boolean;
}

export async function persistBriefing(input: PersistBriefingInput): Promise<{ ok: boolean; id?: string }> {
  const doc = await prisma.briefingDocument.create({
    data: {
      briefingKind: input.generated.briefingKind,
      title: input.generated.title,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      jurisdictionKey: input.jurisdictionKey ?? null,
      corridorKey: input.corridorKey ?? null,
      watchlistId: input.watchlistId ?? null,
      status: input.publishImmediately ? "PUBLISHED" : "GENERATED",
      summary: input.generated.summary,
      payloadJson: JSON.stringify({ reasonLog: input.generated.reasonLog }),
      authoredByUserId: input.actor?.userId ?? null,
      authoredByEmail: input.actor?.email ?? null,
      publishedAt: input.publishImmediately ? new Date() : null,
    },
  });
  if (input.generated.sections.length > 0) {
    await prisma.briefingSection.createMany({
      data: input.generated.sections.map((s) => ({
        briefingId: doc.id,
        position: s.position,
        sectionKind: s.sectionKind,
        title: s.title,
        body: s.body,
        payloadJson: s.payload ? JSON.stringify(s.payload) : null,
      })),
    });
  }
  emitWorkspaceAudit({
    action: "persist_briefing",
    briefingId: doc.id,
    decision: input.publishImmediately ? "published" : "generated",
    factors: { briefingKind: input.generated.briefingKind, sections: input.generated.sections.length },
  });
  return { ok: true, id: doc.id };
}
