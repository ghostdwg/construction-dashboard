// lib/services/meetingRegister/segments.ts
//
// Module R2-B1 — transcript segment materialization.
//
// Meeting.rawTranscript (transcription-service JSON with a `segments` array)
// is IMMUTABLE. This module projects it once into MeetingTranscriptSegment
// rows: original* columns are frozen at materialization; current* columns
// are the correction overlay. For manual/pasted transcripts (no raw JSON),
// segments materialize from "[HH:MM:SS] Speaker: text" display lines.
// Materialization is deterministic and idempotent — if rows exist, it is a
// no-op. Nothing here ever writes Meeting.rawTranscript.

import { prisma } from "@/lib/prisma";
import type { ServiceResult } from "./types";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Db = PrismaTx | typeof prisma;

export type ParsedSegment = {
  segmentIndex: number;
  startSec: number | null;
  endSec: number | null;
  speakerLabel: string | null;
  text: string;
};

type RawTranscriptSegment = {
  speaker?: unknown;
  text?: unknown;
  start?: unknown;
  end?: unknown;
};

/** Parse the transcription-service JSON blob (WhisperX/AssemblyAI shape). */
export function parseRawTranscriptSegments(rawTranscript: string): ParsedSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTranscript);
  } catch {
    return [];
  }
  const segments = (parsed as { segments?: unknown })?.segments;
  if (!Array.isArray(segments)) return [];

  const out: ParsedSegment[] = [];
  for (const seg of segments as RawTranscriptSegment[]) {
    const text = typeof seg?.text === "string" ? seg.text.trim() : "";
    if (!text) continue;
    const start = typeof seg.start === "number" && Number.isFinite(seg.start) ? seg.start : null;
    const end = typeof seg.end === "number" && Number.isFinite(seg.end) ? seg.end : start;
    out.push({
      segmentIndex: out.length,
      startSec: start,
      endSec: end,
      speakerLabel: typeof seg.speaker === "string" && seg.speaker.trim() ? seg.speaker.trim() : null,
      text,
    });
  }
  return out;
}

// Display-transcript line: "[HH:MM:SS] Speaker Name: text" or "[MM:SS] ...".
const DISPLAY_LINE = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*([^:]{1,120}?)\s*:\s*(.+)$/;

/** Fallback parser for manual/pasted display transcripts. */
export function parseDisplayTranscriptSegments(transcript: string): ParsedSegment[] {
  const out: ParsedSegment[] = [];
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(DISPLAY_LINE);
    if (m) {
      const [, a, b, c, speaker, text] = m;
      // [HH:MM:SS] when the third group exists, else [MM:SS]
      const startSec = c !== undefined
        ? Number(a) * 3600 + Number(b) * 60 + Number(c)
        : Number(a) * 60 + Number(b);
      out.push({
        segmentIndex: out.length,
        startSec,
        endSec: startSec,
        speakerLabel: speaker.trim() || null,
        text: text.trim(),
      });
    } else {
      out.push({
        segmentIndex: out.length,
        startSec: null,
        endSec: null,
        speakerLabel: null,
        text: line,
      });
    }
  }
  return out;
}

/**
 * Materialize segments for a meeting (idempotent). Prefers the immutable
 * raw JSON; falls back to the display transcript for manual meetings.
 */
export async function materializeSegments(
  bidId: number,
  meetingId: number
): Promise<ServiceResult<{ created: number; existing: number }>> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true, rawTranscript: true, transcript: true },
  });
  if (!meeting) return { ok: false, error: "Not found" };

  const existing = await prisma.meetingTranscriptSegment.count({
    where: { meetingId },
  });
  if (existing > 0) return { ok: true, value: { created: 0, existing } };

  let parsed: ParsedSegment[] = [];
  if (meeting.rawTranscript) parsed = parseRawTranscriptSegments(meeting.rawTranscript);
  if (parsed.length === 0 && meeting.transcript) {
    parsed = parseDisplayTranscriptSegments(meeting.transcript);
  }
  if (parsed.length === 0) return { ok: true, value: { created: 0, existing: 0 } };

  await prisma.$transaction(async (tx) => {
    for (const seg of parsed) {
      await tx.meetingTranscriptSegment.create({
        data: {
          meetingId,
          bidId,
          segmentIndex: seg.segmentIndex,
          sortKey: seg.segmentIndex,
          startSec: seg.startSec,
          endSec: seg.endSec,
          originalSpeakerLabel: seg.speakerLabel,
          originalText: seg.text,
          currentSpeakerLabel: seg.speakerLabel,
          currentText: seg.text,
        },
      });
    }
  });
  return { ok: true, value: { created: parsed.length, existing: 0 } };
}

export async function listSegments(bidId: number, meetingId: number, db: Db = prisma) {
  return db.meetingTranscriptSegment.findMany({
    where: { meetingId, bidId, isActive: true },
    orderBy: { sortKey: "asc" },
  });
}

function formatTimestamp(startSec: number | null): string {
  if (startSec == null) return "";
  const total = Math.max(0, Math.floor(startSec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `[${String(h).padStart(2, "0")}:${mm}:${ss}]` : `[${mm}:${ss}]`;
}

/**
 * Rebuild the DERIVED display transcript (Meeting.transcript) from the
 * current segment overlay so downstream consumers (analysis rerun, PDF)
 * see corrections. Raw JSON is untouched — this is projection, not source.
 * Accepts a transaction client so correction ops can rebuild atomically
 * with the segment mutation they record.
 */
export async function rebuildDisplayTranscript(
  bidId: number,
  meetingId: number,
  db: Db = prisma
): Promise<ServiceResult<{ lineCount: number }>> {
  const segments = await listSegments(bidId, meetingId, db);
  if (segments.length === 0) return { ok: true, value: { lineCount: 0 } };

  const lines = segments.map((seg) => {
    const ts = formatTimestamp(seg.startSec);
    const speaker = seg.isUnknownSpeaker
      ? "[UNKNOWN]"
      : seg.currentSpeakerLabel ?? "[UNKNOWN]";
    return `${ts ? ts + " " : ""}${speaker}: ${seg.currentText}`;
  });
  await db.meeting.update({
    where: { id: meetingId },
    data: { transcript: lines.join("\n") },
  });
  return { ok: true, value: { lineCount: lines.length } };
}
