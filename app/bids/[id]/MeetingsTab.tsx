"use client";

// Phase 5D — Meeting Intelligence Tab
//
// Workflow:
//   1. Create meeting (title, date, type)
//   2. Upload audio → sidecar → AssemblyAI transcription (with speaker diarization)
//      OR paste transcript manually
//   3. Poll status while TRANSCRIBING
//   4. Review + name speakers (resolve SPEAKER_A → "John Smith, GC PM")
//   5. Run Claude analysis → action items, decisions, risks, summary
//   6. Manage action items register (inline status, close, reassign)

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  Plus,
  ChevronDown,
  ChevronRight,
  Check,
  Clock,
  Download,
  Loader2,
  Trash2,
  FileText,
  Sparkles,
  Upload,
  Users,
  ClipboardCheck,
  X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type MeetingType = "GENERAL" | "OAC" | "SUBCONTRACTOR" | "PRECONSTRUCTION" | "SAFETY" | "KICKOFF";
type MeetingStatus = "PENDING" | "UPLOADING" | "TRANSCRIBING" | "AWAITING_SOURCE_MAP" | "AWAITING_NAMES" | "ANALYZING" | "READY" | "FAILED";
type ActionStatus = "OPEN" | "IN_PROGRESS" | "CLOSED" | "DEFERRED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type MeetingSummary = {
  id: number;
  title: string;
  meetingDate: string;
  meetingType: MeetingType;
  location: string | null;
  status: MeetingStatus;
  audioFileName: string | null;
  durationSeconds: number | null;
  transcriptionSource: string | null;
  hasSummary: boolean;
  participantCount: number;
  actionItemCount: number;
  openActionItemCount: number;
  uploadedAt: string | null;
  analyzedAt: string | null;
};

type Participant = {
  id: number;
  name: string;
  role: string | null;
  company: string | null;
  speakerLabel: string | null;
  projectContactId: number | null;
  confidence: number | null;
  isGcTeam: boolean;
  speakerType: string | null;
};

type DeclaredParticipant = {
  name: string;
  role: string;
  company: string;
  isGcTeam: boolean;
  speakerType: "REMOTE" | "IN_ROOM";
};

type ActionItem = {
  id: number;
  meetingId: number;
  description: string;
  assignedToId: number | null;
  assignedToName: string | null;
  dueDate: string | null;
  priority: Priority;
  status: ActionStatus;
  sourceText: string | null;
  closedAt: string | null;
  notes: string | null;
  isGcTask: boolean;
  carriedFromDate: string | null;
  createdAt: string;
};

type MeetingOpenIssue = {
  text: string;
  reason: string;
  carriedFrom: string | null;
};

type MeetingRedFlag = {
  tag: string;
  description: string;
};

type SpeakerCluster = {
  id:           string;
  type:         "REMOTE" | "IN_ROOM";
  resolvedName: string | null;
  totalSeconds: number;
  segmentCount: number;
  vttOverlap?: string | null;
};

type SpeakerMappingData = {
  clusters: SpeakerCluster[];
  mapping:  Record<string, string>;
};

type TeamsSource = {
  mode: "PERSON" | "SHARED_MIC" | "IGNORE";
  participantId?: number;
  participantIds?: number[];
};

type SourceMappingData = {
  vttSpeakers: string[];
  teamsSources: Record<string, TeamsSource>;
  audioOffsetSeconds: number;
};

type MeetingDetail = {
  id: number;
  title: string;
  meetingDate: string;
  meetingType: MeetingType;
  location: string | null;
  status: MeetingStatus;
  audioFileName: string | null;
  durationSeconds: number | null;
  transcriptionSource: string | null;
  transcriptionJobId: string | null;
  transcript: string | null;
  processingMode: string | null;
  speakerMapping: string | null;
  summary: string | null;
  keyDecisions: string[];
  openIssues: MeetingOpenIssue[];
  redFlags: MeetingRedFlag[];
  analysisVersion: number;
  reviewStatus: string;
  uploadedAt: string | null;
  analyzedAt: string | null;
  participants: Participant[];
  actionItems: ActionItem[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  GENERAL: "General",
  OAC: "OAC",
  SUBCONTRACTOR: "Subcontractor",
  PRECONSTRUCTION: "Preconstruction",
  SAFETY: "Safety",
  KICKOFF: "Kickoff",
};

const STATUS_CONFIG: Record<MeetingStatus, { label: string; color: string }> = {
  PENDING:        { label: "Pending",         color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  UPLOADING:      { label: "Uploading…",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  TRANSCRIBING:   { label: "Transcribing",    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  AWAITING_SOURCE_MAP: { label: "Map Sources", color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  AWAITING_NAMES: { label: "Name Speakers",   color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  ANALYZING:      { label: "Analyzing",       color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  READY:          { label: "Ready",           color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  FAILED:         { label: "Failed",          color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  CRITICAL: { label: "Critical", color: "text-red-600 dark:text-red-400" },
  HIGH:     { label: "High",     color: "text-orange-600 dark:text-orange-400" },
  MEDIUM:   { label: "Medium",   color: "text-amber-600 dark:text-amber-400" },
  LOW:      { label: "Low",      color: "text-zinc-500 dark:text-zinc-400" },
};

const ACTION_STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "OPEN",        label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "CLOSED",      label: "Closed" },
  { value: "DEFERRED",    label: "Deferred" },
];

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function isActive(status: MeetingStatus) {
  return (
    status === "UPLOADING" ||
    status === "TRANSCRIBING" ||
    status === "AWAITING_SOURCE_MAP" ||
    status === "ANALYZING"
  );
}

function parseSpeakerMapping(raw: string | null): SpeakerMappingData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SpeakerMappingData>;
    return {
      clusters: parsed.clusters ?? [],
      mapping: parsed.mapping ?? {},
    };
  } catch {
    return null;
  }
}

function parseSourceMapping(raw: string | null): SourceMappingData {
  if (!raw) return { vttSpeakers: [], teamsSources: {}, audioOffsetSeconds: 0 };
  try {
    const parsed = JSON.parse(raw) as {
      vtt_speakers?: string[];
      teams_sources?: Record<string, TeamsSource>;
      audio_offset_seconds?: number;
    };
    return {
      vttSpeakers: parsed.vtt_speakers ?? [],
      teamsSources: parsed.teams_sources ?? {},
      audioOffsetSeconds: parsed.audio_offset_seconds ?? 0,
    };
  } catch {
    return { vttSpeakers: [], teamsSources: {}, audioOffsetSeconds: 0 };
  }
}

const RED_FLAG_CONFIG: Record<string, { bg: string; text: string }> = {
  DELAY:      { bg: "bg-amber-100 dark:bg-amber-900/30",   text: "text-amber-700 dark:text-amber-300" },
  COST:       { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-300" },
  RISK:       { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300" },
  DISPUTE:    { bg: "bg-red-100 dark:bg-red-900/30",       text: "text-red-700 dark:text-red-400" },
  SAFETY:     { bg: "bg-red-200 dark:bg-red-900/40",       text: "text-red-800 dark:text-red-300" },
  COMPLIANCE: { bg: "bg-blue-100 dark:bg-blue-900/30",     text: "text-blue-700 dark:text-blue-300" },
};

function confidenceDotClass(conf: number | null): string {
  if (conf === null || conf < 0.5) return "bg-red-400";
  if (conf < 0.75) return "bg-amber-400";
  return "bg-emerald-400";
}

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MeetingsTab({ bidId }: { bidId: number }) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [view, setView] = useState<"meetings" | "actions">("meetings");

  const loadMeetings = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMeetings(data.meetings);
      setLoadError(null);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setLoadError("Meetings load timed out");
      } else {
        setLoadError(e instanceof Error ? e.message : "Failed to load meetings");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [bidId]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  // Poll while any meeting is actively processing
  useEffect(() => {
    const needsPoll = meetings.some((m) => isActive(m.status));
    if (!needsPoll) return;
    const timer = setTimeout(() => loadMeetings(), 5000);
    return () => clearTimeout(timer);
  }, [meetings, loadMeetings]);

  const totalOpen = meetings.reduce((s, m) => s + m.openActionItemCount, 0);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Meeting Intelligence
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
            {totalOpen > 0 && ` · ${totalOpen} open action item${totalOpen !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(view === "meetings" ? "actions" : "meetings")}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {view === "meetings" ? (
              <><ClipboardCheck className="h-3.5 w-3.5" /> All Action Items</>
            ) : (
              <><Mic className="h-3.5 w-3.5" /> Meetings</>
            )}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" /> Add Meeting
          </button>
        </div>
      </div>

      {showAdd && (
        <AddMeetingForm
          bidId={bidId}
          onSaved={(id) => { setShowAdd(false); loadMeetings(); setExpanded(id); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3 dark:border-red-900/60 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load meetings: {loadError}</p>
          <button
            onClick={loadMeetings}
            className="shrink-0 rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-900/20"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && view === "actions" && (
        <AllActionItemsView bidId={bidId} meetings={meetings} onReload={loadMeetings} />
      )}

      {!loading && !loadError && view === "meetings" && meetings.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 py-12 text-center">
          <Mic className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No meetings yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Add a meeting to start capturing transcripts and action items
          </p>
        </div>
      )}

      {!loading && !loadError && view === "meetings" && meetings.map((m) => (
        <MeetingRow
          key={m.id}
          meeting={m}
          bidId={bidId}
          expanded={expanded === m.id}
          onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
          onReload={loadMeetings}
        />
      ))}
    </div>
  );
}

// ── Add Meeting Form ─────────────────────────────────────────────────────��────

function AddMeetingForm({
  bidId,
  onSaved,
  onCancel,
}: {
  bidId: number;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<MeetingType>("GENERAL");
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState<DeclaredParticipant[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function addParticipant() {
    setParticipants((prev) => [
      ...prev,
      { name: "", role: "", company: "", isGcTeam: false, speakerType: "IN_ROOM" },
    ]);
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          meetingDate: date,
          meetingType: type,
          location,
          participants: participants
            .filter((participant) => participant.name.trim())
            .map((participant) => ({
              name: participant.name.trim(),
              role: participant.role.trim() || undefined,
              company: participant.company.trim() || undefined,
              isGcTeam: participant.isGcTeam,
              speakerType: participant.speakerType,
            })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      onSaved(data.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to create meeting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">New Meeting</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="OAC Meeting #4 — HVAC coordination"
            className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MeetingType)}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {Object.entries(MEETING_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Location (optional)</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Trailer, Conference Room B, Zoom…"
            className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div className="col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 block">Attendees (optional)</label>
            <button
              type="button"
              onClick={addParticipant}
              className="text-xs px-2 py-1 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              + Add Attendee
            </button>
          </div>
          {participants.length > 0 && (
            <div className="space-y-2">
              {participants.map((participant, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    value={participant.name}
                    onChange={(e) =>
                      setParticipants((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, name: e.target.value } : row
                        )
                      )
                    }
                    placeholder="Full name"
                    className="col-span-12 md:col-span-3 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <input
                    value={participant.role}
                    onChange={(e) =>
                      setParticipants((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, role: e.target.value } : row
                        )
                      )
                    }
                    placeholder="PM / Super / Owner Rep…"
                    className="col-span-12 md:col-span-3 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <input
                    value={participant.company}
                    onChange={(e) =>
                      setParticipants((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, company: e.target.value } : row
                        )
                      )
                    }
                    placeholder="Company"
                    className="col-span-12 md:col-span-3 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <label className="col-span-6 md:col-span-1 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={participant.isGcTeam}
                      onChange={(e) =>
                        setParticipants((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, isGcTeam: e.target.checked } : row
                          )
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    GC Team
                  </label>
                  <select
                    value={participant.speakerType}
                    onChange={(e) =>
                      setParticipants((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, speakerType: e.target.value as DeclaredParticipant["speakerType"] }
                            : row
                        )
                      )
                    }
                    className="col-span-4 md:col-span-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="REMOTE">Remote</option>
                    <option value="IN_ROOM">In-Room</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setParticipants((prev) => prev.filter((_, rowIndex) => rowIndex !== index))}
                    className="col-span-2 md:col-span-1 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {saveError && (
        <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!title.trim() || saving}
          className="text-xs px-4 py-1.5 rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {saving ? "Saving…" : "Create Meeting"}
        </button>
      </div>
    </div>
  );
}

// ── Meeting Row ───────────────────────────────────────────────────────────────

function MeetingRow({
  meeting,
  bidId,
  expanded,
  onToggle,
  onReload,
}: {
  meeting: MeetingSummary;
  bidId: number;
  expanded: boolean;
  onToggle: () => void;
  onReload: () => void;
}) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const statusCfg = STATUS_CONFIG[meeting.status];

  useEffect(() => {
    if (!expanded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingDetail(true);
    setDetailError(null);
    fetch(`/api/bids/${bidId}/meetings/${meeting.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MeetingDetail>;
      })
      .then((d) => { setDetail(d); setLoadingDetail(false); })
      .catch((e: Error) => { setDetailError(e.message); setLoadingDetail(false); });
  }, [expanded, bidId, meeting.id]);

  async function deleteMeeting() {
    if (!confirm("Delete this meeting and all its action items?")) return;
    await fetch(`/api/bids/${bidId}/meetings/${meeting.id}`, { method: "DELETE" });
    onReload();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      {/* Summary row — div not button so the delete button inside is valid HTML */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-left cursor-pointer"
      >
        {expanded
          ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {meeting.title}
            </span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusCfg.color}`}>
              {isActive(meeting.status) && <Loader2 className="inline h-2.5 w-2.5 animate-spin mr-0.5" />}
              {statusCfg.label}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {MEETING_TYPE_LABELS[meeting.meetingType]}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{fmtDate(meeting.meetingDate)}</span>
            {meeting.location && <span>· {meeting.location}</span>}
            {meeting.durationSeconds && <span>· {formatDuration(meeting.durationSeconds)}</span>}
            {meeting.participantCount > 0 && (
              <span>· <Users className="inline h-3 w-3" /> {meeting.participantCount}</span>
            )}
            {meeting.openActionItemCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                · {meeting.openActionItemCount} open item{meeting.openActionItemCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); deleteMeeting(); }}
          className="p-1 rounded text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 pb-4 pt-3">
          {loadingDetail && (
            <div className="flex items-center gap-2 text-sm text-zinc-500 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!loadingDetail && detailError && (
            <p className="text-sm text-red-600 dark:text-red-400 py-3">
              Failed to load meeting detail: {detailError}
            </p>
          )}
          {!loadingDetail && detail && !detailError && (
            <MeetingDetailPanel
              bidId={bidId}
              detail={detail}
              onReload={() => {
                onReload();
                setLoadingDetail(true);
                setDetailError(null);
                fetch(`/api/bids/${bidId}/meetings/${detail.id}`)
                  .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json() as Promise<MeetingDetail>;
                  })
                  .then((d) => { setDetail(d); setLoadingDetail(false); })
                  .catch((e: Error) => { setDetailError(e.message); setLoadingDetail(false); });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Speaker Naming Panel ──────────────────────────────────────────────────────

function SpeakerNamingPanel({
  bidId,
  meetingId,
  speakerMappingData,
  declaredParticipants,
  teamsSources,
  onDone,
}: {
  bidId: number;
  meetingId: number;
  speakerMappingData: SpeakerMappingData;
  declaredParticipants: Array<{
    id: number;
    name: string;
    role: string | null;
    speakerType: string | null;
    speakerLabel: string | null;
  }>;
  teamsSources: Record<string, TeamsSource>;
  onDone: () => void;
}) {
  const inRoomClusters = speakerMappingData.clusters.filter((c) => c.type === "IN_ROOM");
  const remoteClusters = speakerMappingData.clusters.filter((c) => c.type === "REMOTE");
  const unmappedDeclared = declaredParticipants.filter(
    (participant) =>
      (participant.speakerType === "IN_ROOM" || participant.speakerType === "UNKNOWN") &&
      !participant.speakerLabel
  );
  const declaredNames = new Set(unmappedDeclared.map((participant) => participant.name));
  const participantById = new Map(declaredParticipants.map((participant) => [participant.id, participant]));

  function candidatesForCluster(cluster: SpeakerCluster) {
    const micSource = cluster.vttOverlap ? teamsSources[cluster.vttOverlap] : undefined;
    if (micSource?.mode === "SHARED_MIC") {
      return unmappedDeclared.filter((participant) => micSource.participantIds?.includes(participant.id));
    }
    if (micSource?.mode === "PERSON") return [];
    return unmappedDeclared;
  }

  function autoPersonForCluster(cluster: SpeakerCluster) {
    const micSource = cluster.vttOverlap ? teamsSources[cluster.vttOverlap] : undefined;
    return micSource?.mode === "PERSON" && micSource.participantId
      ? participantById.get(micSource.participantId)
      : undefined;
  }

  const [names, setNames] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of inRoomClusters) init[c.id] = speakerMappingData.mapping[c.id] ?? "";
    return init;
  });
  const [otherMode, setOtherMode] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of inRoomClusters) {
      const current = speakerMappingData.mapping[c.id] ?? "";
      init[c.id] = !!current && !declaredNames.has(current);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtSecs(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  async function confirm() {
    const finalNames = { ...names };
    for (const cluster of inRoomClusters) {
      const autoPerson = autoPersonForCluster(cluster);
      if (autoPerson) finalNames[cluster.id] = autoPerson.name;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings/${meetingId}/speaker-mapping`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mapping: finalNames }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setError((err as { error?: string }).error ?? "Failed");
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-900/20">
        <p className="text-sm font-medium text-violet-800 dark:text-violet-200">
          Teams Hybrid — Identify In-Room Speakers
        </p>
        <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">
          Online participants were identified from the Teams transcript.
          Name the in-room speakers detected by diarization, then confirm.
        </p>
      </div>

      {remoteClusters.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Online (from Teams VTT)
          </p>
          <div className="flex flex-wrap gap-2">
            {remoteClusters.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                {c.resolvedName ?? c.id}
                <span className="text-[10px] text-emerald-500">· {fmtSecs(c.totalSeconds)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {inRoomClusters.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            In-Room Speakers — {inRoomClusters.length} cluster{inRoomClusters.length !== 1 ? "s" : ""} detected
          </p>
          {inRoomClusters.map((c) => {
            const autoPerson = autoPersonForCluster(c);
            const candidates = candidatesForCluster(c);
            return (
            <div key={c.id} className="flex items-center gap-3">
              <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 w-20 shrink-0">
                <span className="block">{c.id}</span>
                <span className="block text-zinc-400 dark:text-zinc-500">
                  {fmtSecs(c.totalSeconds)} · {c.segmentCount} seg
                </span>
              </div>
              {autoPerson ? (
                <span className="flex-1 rounded border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {autoPerson.name}
                </span>
              ) : candidates.length > 0 ? (
                <div className="flex-1 space-y-2">
                  <select
                    value={otherMode[c.id] ? "__other__" : names[c.id] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "__other__") {
                        setOtherMode((prev) => ({ ...prev, [c.id]: true }));
                        setNames((prev) => ({
                          ...prev,
                          [c.id]: declaredNames.has(prev[c.id] ?? "") ? "" : prev[c.id] ?? "",
                        }));
                        return;
                      }
                      setOtherMode((prev) => ({ ...prev, [c.id]: false }));
                      setNames((prev) => ({ ...prev, [c.id]: value }));
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value=""></option>
                    {candidates.map((participant) => (
                      <option key={participant.id} value={participant.name}>
                        {participant.role ? `${participant.name} — ${participant.role}` : participant.name}
                      </option>
                    ))}
                    <option value="__other__">Other (type name)…</option>
                  </select>
                  {otherMode[c.id] && (
                    <input
                      type="text"
                      value={names[c.id] ?? ""}
                      onChange={(e) => setNames((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="Full name"
                      className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={names[c.id] ?? ""}
                  onChange={(e) => setNames((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  placeholder="Full name"
                  className="flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              )}
            </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={confirm}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
        >
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="h-3.5 w-3.5" /> Confirm &amp; Continue</>}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="text-xs px-3 py-2 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
        >
          Skip (keep SPEAKER_N labels)
        </button>
      </div>
    </div>
  );
}

// ── Meeting Detail Panel ──────────────────────────────────────────────────────

function SourceMappingPanel({
  bidId,
  meetingId,
  sourceMappingData,
  declaredParticipants,
  onDone,
}: {
  bidId: number;
  meetingId: number;
  sourceMappingData: SourceMappingData;
  declaredParticipants: Array<{ id: number; name: string; role: string | null }>;
  onDone: () => void;
}) {
  const [sources, setSources] = useState<Record<string, TeamsSource>>(() =>
    Object.fromEntries(
      sourceMappingData.vttSpeakers.map((label) => [
        label,
        sourceMappingData.teamsSources[label] ?? {
          mode: /unknown|system|caption/i.test(label) ? "IGNORE" : "PERSON",
        },
      ])
    )
  );
  const [audioOffset, setAudioOffset] = useState(sourceMappingData.audioOffsetSeconds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings/${meetingId}/source-mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, audioOffsetSeconds: audioOffset }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setError((err as { error?: string }).error ?? "Failed");
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function setSource(label: string, source: TeamsSource) {
    setSources((prev) => ({ ...prev, [label]: source }));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-900/20">
        <p className="text-sm font-medium text-violet-800 dark:text-violet-200">
          Teams Hybrid — Classify Speaker Sources
        </p>
        <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">
          Each Teams speaker may be one person or a shared room mic. Classify each label so diarization can identify the real speakers.
        </p>
      </div>

      <div className="space-y-3">
        {sourceMappingData.vttSpeakers.map((label) => {
          const source = sources[label] ?? { mode: "PERSON" as const };
          return (
            <div key={label} className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 space-y-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{label}</p>
                </div>
                <select
                  value={source.mode}
                  onChange={(e) =>
                    setSource(label, {
                      mode: e.target.value as TeamsSource["mode"],
                    })
                  }
                  className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="PERSON">Person</option>
                  <option value="SHARED_MIC">Shared Mic</option>
                  <option value="IGNORE">Ignore</option>
                </select>
              </div>

              {source.mode === "PERSON" && (
                <select
                  value={source.participantId ?? ""}
                  onChange={(e) =>
                    setSource(label, {
                      mode: "PERSON",
                      participantId: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value=""></option>
                  {declaredParticipants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.role ? `${participant.name} — ${participant.role}` : participant.name}
                    </option>
                  ))}
                </select>
              )}

              {source.mode === "SHARED_MIC" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {declaredParticipants.map((participant) => {
                    const selected = source.participantIds?.includes(participant.id) ?? false;
                    return (
                      <label key={participant.id} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const current = source.participantIds ?? [];
                            setSource(label, {
                              mode: "SHARED_MIC",
                              participantIds: e.target.checked
                                ? [...current, participant.id]
                                : current.filter((id) => id !== participant.id),
                            });
                          }}
                          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
                        />
                        <span>{participant.role ? `${participant.name} — ${participant.role}` : participant.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        <label className="text-xs text-zinc-500 dark:text-zinc-400 block">
          Recording started ___ seconds into the meeting
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={audioOffset}
          onChange={(e) => setAudioOffset(Number(e.target.value))}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Set if you started recording after the meeting began</p>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={confirm}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
        >
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</> : "Confirm & Start Diarization"}
        </button>
        <button
          onClick={async () => {
            await fetch(`/api/bids/${bidId}/meetings/${meetingId}/source-mapping`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sources: {}, audioOffsetSeconds: 0 }),
            });
            onDone();
          }}
          disabled={saving}
          className="text-xs px-3 py-2 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
        >
          Skip (no source mapping)
        </button>
      </div>
    </div>
  );
}

function MeetingDetailPanel({
  bidId,
  detail,
  onReload,
}: {
  bidId: number;
  detail: MeetingDetail;
  onReload: () => void;
}) {
  const [activeSection, setActiveSection] = useState<"transcript" | "analysis" | "items">(
    detail.status === "READY" && detail.summary ? "analysis" : "transcript"
  );
  const [reviewStatus, setReviewStatus] = useState(detail.reviewStatus ?? "DRAFT");
  const [patchingReview, setPatchingReview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [manualTranscript, setManualTranscript] = useState(detail.transcript ?? "");
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hybridMode, setHybridMode] = useState(false);
  const [hybridVttFile, setHybridVttFile] = useState<File | null>(null);
  const [hybridAudioFile, setHybridAudioFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hybridVttRef = useRef<HTMLInputElement>(null);
  const hybridAudioRef = useRef<HTMLInputElement>(null);

  // Poll if actively processing — call /status when TRANSCRIBING so it actually advances
  useEffect(() => {
    if (!isActive(detail.status as MeetingStatus)) return;
    const timer = setTimeout(async () => {
      if (detail.status === "TRANSCRIBING") {
        await fetch(`/api/bids/${bidId}/meetings/${detail.id}/status`);
      }
      onReload();
    }, 5000);
    return () => clearTimeout(timer);
  }, [detail.status, detail.id, bidId, onReload]);

  useEffect(() => {
    setReviewStatus(detail.reviewStatus ?? "DRAFT");
  }, [detail.reviewStatus]);

  async function uploadAudio(file: File) {
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("audio", file);
    const res = await fetch(`/api/bids/${bidId}/meetings/${detail.id}/upload`, {
      method: "POST",
      body: fd,
    });
    setUploading(false);
    const data = await res.json();
    if (!res.ok) {
      setUploadError(data.error ?? "Upload failed");
    } else if (data.manual) {
      setUploadError("AssemblyAI not configured — enter transcript manually below.");
    }
    onReload();
  }

  async function uploadHybrid() {
    if (!hybridVttFile || !hybridAudioFile) {
      setUploadError("Both a VTT file and a recording file are required.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("vtt",   hybridVttFile);
    fd.append("audio", hybridAudioFile);
    const res = await fetch(`/api/bids/${bidId}/meetings/${detail.id}/upload-hybrid`, {
      method: "POST",
      body:   fd,
    });
    setUploading(false);
    const data = await res.json();
    if (!res.ok) {
      setUploadError((data as { error?: string }).error ?? "Upload failed");
    } else {
      setHybridVttFile(null);
      setHybridAudioFile(null);
    }
    onReload();
  }

  async function saveManualTranscript() {
    setSavingTranscript(true);
    await fetch(`/api/bids/${bidId}/meetings/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: manualTranscript, status: "READY" }),
    });
    setSavingTranscript(false);
    onReload();
  }

  async function runAnalysis() {
    setAnalyzing(true);
    const res = await fetch(`/api/bids/${bidId}/meetings/${detail.id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setAnalyzing(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Analysis failed" }));
      alert(err.error ?? "Analysis failed");
      onReload(); // reset ANALYZING → READY in UI
      return;
    }
    onReload();
    setActiveSection("analysis");
  }

  async function exportPdf() {
    setExporting(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings/${detail.id}/export-pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        alert(err.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? `meeting_${detail.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function patchReviewStatus(newStatus: string) {
    setPatchingReview(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/meetings/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to update review status" }));
        alert(err.error ?? "Failed to update review status");
        return;
      }
      setReviewStatus(newStatus);
    } finally {
      setPatchingReview(false);
    }
  }

  const hasTranscript = !!detail.transcript?.trim() || !!manualTranscript.trim();
  const sourceMappingData = parseSourceMapping(detail.speakerMapping ?? null);

  return (
    <div className="space-y-4">
      {/* ── Status banner for in-progress states ── */}
      {isActive(detail.status as MeetingStatus) && (() => {
        const uploadStale = detail.status === "UPLOADING" && detail.uploadedAt
          ? Date.now() - new Date(detail.uploadedAt).getTime() > 5 * 60 * 1000
          : false;

        if (uploadStale) {
          return (
            <div className="flex items-center justify-between px-3 py-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
              <span>Upload timed out — the GPU connection may have stalled.</span>
              <button
                onClick={async () => {
                  await fetch(`/api/bids/${bidId}/meetings/${detail.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "PENDING", transcriptionJobId: null }),
                  });
                  onReload();
                }}
                className="ml-3 shrink-0 px-2 py-1 rounded text-xs font-medium bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60"
              >
                Reset &amp; Retry
              </button>
            </div>
          );
        }

        return (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            {detail.status === "UPLOADING" && "Uploading to GPU — this may take a few minutes for large files…"}
            {detail.status === "AWAITING_SOURCE_MAP" && "Classify Teams speaker sources before diarization starts."}
            {detail.status === "TRANSCRIBING" && (
              detail.processingMode === "HYBRID"
                ? "Diarizing recording on GPU — this takes a few minutes…"
                : "Transcribing audio — this takes 1-5 minutes…"
            )}
            {detail.status === "ANALYZING" && "Running Claude analysis on transcript…"}
          </div>
        );
      })()}

      {/* ── Section tabs ── */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {(["transcript", "analysis", "items"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeSection === s
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {s === "transcript" && "Transcript"}
            {s === "analysis" && "Analysis"}
            {s === "items" && `Action Items (${detail.actionItems.length})`}
          </button>
        ))}
      </div>

      {/* ── Speaker Naming (AWAITING_NAMES) ── */}
      {detail.status === "AWAITING_SOURCE_MAP" && sourceMappingData.vttSpeakers.length > 0 && (
        <SourceMappingPanel
          bidId={bidId}
          meetingId={detail.id}
          sourceMappingData={sourceMappingData}
          declaredParticipants={detail.participants}
          onDone={onReload}
        />
      )}

      {detail.status === "AWAITING_NAMES" && (() => {
        const smd = parseSpeakerMapping(detail.speakerMapping ?? null);
        return smd ? (
          <SpeakerNamingPanel
            bidId={bidId}
            meetingId={detail.id}
            speakerMappingData={smd}
            declaredParticipants={detail.participants}
            teamsSources={sourceMappingData.teamsSources}
            onDone={onReload}
          />
        ) : (
          <p className="text-sm text-zinc-500">Loading speaker data…</p>
        );
      })()}

      {/* ── Transcript ── */}
      {activeSection === "transcript" && detail.status !== "AWAITING_NAMES" && detail.status !== "AWAITING_SOURCE_MAP" && (
        <div className="space-y-3">
          {(detail.status === "PENDING" || detail.status === "FAILED") && (
            <div className="space-y-2">
              {/* Mode toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHybridMode(false)}
                  className={`text-xs px-3 py-1 rounded border transition-colors ${
                    !hybridMode
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  Audio / VTT
                </button>
                <button
                  onClick={() => setHybridMode(true)}
                  className={`text-xs px-3 py-1 rounded border transition-colors ${
                    hybridMode
                      ? "border-violet-600 bg-violet-600 text-white"
                      : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  Teams Hybrid (VTT + Recording)
                </button>
              </div>

              {/* Hybrid upload form */}
              {hybridMode && (
                <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-800 dark:bg-violet-900/10 space-y-3">
                  <p className="text-xs text-violet-700 dark:text-violet-300">
                    Upload the Teams VTT transcript (names online participants) and the meeting
                    recording. The GPU worker diarizes in-room speakers automatically.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Teams VTT transcript
                      </label>
                      <button
                        onClick={() => hybridVttRef.current?.click()}
                        className="w-full text-left text-xs px-3 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 truncate"
                      >
                        {hybridVttFile ? hybridVttFile.name : "Choose .vtt file…"}
                      </button>
                      <input
                        ref={hybridVttRef}
                        type="file"
                        accept=".vtt"
                        className="hidden"
                        onChange={(e) => setHybridVttFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Meeting recording
                      </label>
                      <button
                        onClick={() => hybridAudioRef.current?.click()}
                        className="w-full text-left text-xs px-3 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 truncate"
                      >
                        {hybridAudioFile ? hybridAudioFile.name : "Choose audio/video…"}
                      </button>
                      <input
                        ref={hybridAudioRef}
                        type="file"
                        accept="audio/*,video/mp4,video/webm"
                        className="hidden"
                        onChange={(e) => setHybridAudioFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>
                  <button
                    onClick={uploadHybrid}
                    disabled={uploading || !hybridVttFile || !hybridAudioFile}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
                  >
                    {uploading
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                      : <><Upload className="h-3.5 w-3.5" /> Start Hybrid Processing</>
                    }
                  </button>
                </div>
              )}

              {/* Standard upload option */}
              {!hybridMode && (
                <>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 py-8 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
                  >
                    <Upload className="h-6 w-6 text-zinc-400" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Upload audio, video, or transcript</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">MP3, M4A, WAV, MP4, WEBM · max 500 MB</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">TXT, VTT, SRT · loaded directly as transcript</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                        Audio/video requires GPU worker (WHISPERX_URL) or AssemblyAI
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,video/mp4,video/webm,.txt,.vtt,.srt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.type.startsWith("text/") || /\.(txt|vtt|srt)$/i.test(file.name)) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          setManualTranscript((ev.target?.result as string) ?? "");
                        };
                        reader.readAsText(file);
                      } else {
                        uploadAudio(file);
                      }
                    }}
                  />
                  {uploadError && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 px-1">{uploadError}</p>
                  )}
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">— or —</p>
                </>
              )}
              {hybridMode && uploadError && (
                <p className="text-xs text-amber-600 dark:text-amber-400 px-1">{uploadError}</p>
              )}
            </div>
          )}

          {detail.audioFileName && !detail.transcript && detail.status !== "TRANSCRIBING" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Audio: <span className="font-medium">{detail.audioFileName}</span>
              {detail.durationSeconds && ` · ${formatDuration(detail.durationSeconds)}`}
            </p>
          )}

          {detail.transcript && (
            <div className="rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-3">
              {detail.participants.length > 0 && (
                <ParticipantResolver
                  bidId={bidId}
                  meetingId={detail.id}
                  participants={detail.participants}
                  onSaved={onReload}
                />
              )}
              <pre className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed mt-3 max-h-96 overflow-y-auto">
                {detail.transcript}
              </pre>
            </div>
          )}

          {/* Manual transcript input */}
          {!detail.transcript && detail.status !== "TRANSCRIBING" && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <FileText className="inline h-3.5 w-3.5 mr-1" />
                Paste transcript manually
              </label>
              <textarea
                value={manualTranscript}
                onChange={(e) => setManualTranscript(e.target.value)}
                rows={10}
                placeholder={"[00:00] SPEAKER A: Let's get started...\n[00:05] SPEAKER B: Thanks everyone for joining..."}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={saveManualTranscript}
                disabled={!manualTranscript.trim() || savingTranscript}
                className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {savingTranscript ? "Saving…" : "Save Transcript"}
              </button>
            </div>
          )}

          {hasTranscript && detail.status === "READY" && (
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {analyzing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
                : <><Sparkles className="h-3.5 w-3.5" /> Run Claude Analysis</>
              }
            </button>
          )}
        </div>
      )}

      {/* ── Analysis ── */}
      {activeSection === "analysis" && (
        <div className="space-y-4">
          {!detail.summary && !detail.analyzedAt && (
            <div className="py-6 text-center space-y-2">
              <Sparkles className="h-6 w-6 mx-auto text-violet-400" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No analysis yet</p>
              {hasTranscript ? (
                <button
                  onClick={runAnalysis}
                  disabled={analyzing}
                  className="text-xs px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {analyzing
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
                    : <><Sparkles className="h-3.5 w-3.5" /> Run Claude Analysis</>
                  }
                </button>
              ) : (
                <p className="text-xs text-zinc-400">Add a transcript first</p>
              )}
            </div>
          )}

          {detail.summary && (
            <div className="space-y-5">

              {/* §2 Participants */}
              {detail.participants.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detail.participants.map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${confidenceDotClass(p.confidence)}`} />
                      <span className="text-zinc-800 dark:text-zinc-200">{p.name}</span>
                      {p.role && <span className="text-zinc-400 dark:text-zinc-500">{p.role}</span>}
                      {p.isGcTeam && (
                        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">GC</span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {/* §3 Overview */}
              <div>
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                  Overview
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {detail.summary}
                </p>
              </div>

              {/* §4 Key Decisions */}
              {detail.keyDecisions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                    Key Decisions
                  </p>
                  <ul className="space-y-1.5">
                    {detail.keyDecisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* §7 Red Flags */}
              {detail.redFlags.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
                    Red Flags
                  </p>
                  <div className="space-y-2">
                    {detail.redFlags.map((f, i) => {
                      const cfg = RED_FLAG_CONFIG[f.tag] ?? RED_FLAG_CONFIG.RISK;
                      return (
                        <div key={i} className={`flex items-start gap-2.5 px-3 py-2 rounded ${cfg.bg}`}>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border border-current shrink-0 ${cfg.text}`}>
                            {f.tag}
                          </span>
                          <span className={`text-xs leading-relaxed ${cfg.text}`}>{f.description}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* §6 Open Issues */}
              {detail.openIssues.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                    Open Issues
                  </p>
                  <ul className="space-y-2">
                    {detail.openIssues.map((iss, i) => (
                      <li
                        key={i}
                        className="rounded border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-900"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-zinc-900 dark:text-zinc-100">{iss.text}</span>
                          {iss.carriedFrom && (
                            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap">
                              carried {fmtShortDate(iss.carriedFrom)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{iss.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* §8 GC-only action items */}
              {detail.actionItems.some((a) => a.isGcTask && a.status !== "CLOSED") && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-900/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                      GC Action Items
                    </p>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-500">
                      {detail.actionItems.filter((a) => a.isGcTask && a.status !== "CLOSED").length} open
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {detail.actionItems
                      .filter((a) => a.isGcTask && a.status !== "CLOSED")
                      .map((item) => (
                        <li key={item.id} className="flex items-start gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-2 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {item.description}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                              {item.assignedToName && <span>→ {item.assignedToName}</span>}
                              {item.dueDate && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />
                                  {fmtShortDate(item.dueDate)}
                                </span>
                              )}
                              {item.carriedFromDate && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  carried {fmtShortDate(item.carriedFromDate)}
                                </span>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                  <span>v{detail.analysisVersion}</span>
                  <span>·</span>
                  {reviewStatus === "DRAFT" ? (
                    <button
                      onClick={() => patchReviewStatus("IN_REVIEW")}
                      disabled={patchingReview}
                      className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 disabled:opacity-40 inline-flex items-center gap-1"
                    >
                      {patchingReview ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>Submit for Review</span>}
                    </button>
                  ) : reviewStatus === "IN_REVIEW" ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => patchReviewStatus("PUBLISHED")}
                        disabled={patchingReview}
                        className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50 disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        {patchingReview ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>Publish</span>}
                      </button>
                      <button
                        onClick={() => patchReviewStatus("DRAFT")}
                        disabled={patchingReview}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-40"
                      >
                        Revert
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Published
                      </span>
                      <button
                        onClick={() => patchReviewStatus("IN_REVIEW")}
                        disabled={patchingReview}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-40"
                      >
                        Unpublish
                      </button>
                    </div>
                  )}
                  <span>·</span>
                  <span>Analyzed {detail.analyzedAt ? fmtDate(detail.analyzedAt) : "—"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={exportPdf}
                    disabled={exporting}
                    className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 disabled:opacity-40"
                    title="Export meeting minutes PDF"
                  >
                    {exporting
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Exporting…</>
                      : <><Download className="h-3 w-3" /> Export PDF</>
                    }
                  </button>
                  <button
                    onClick={runAnalysis}
                    disabled={analyzing}
                    className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" /> Re-analyze
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Action Items ── */}
      {activeSection === "items" && (
        <ActionItemsPanel
          bidId={bidId}
          meetingId={detail.id}
          items={detail.actionItems}
          onReload={onReload}
        />
      )}
    </div>
  );
}

// ── Participant Resolver ──────────────────────────────────────────────────────

function ParticipantResolver({
  bidId,
  meetingId,
  participants,
  onSaved,
}: {
  bidId: number;
  meetingId: number;
  participants: Participant[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Record<number, string>>(
    Object.fromEntries(participants.map((p) => [p.id, p.name]))
  );

  async function saveName(participantId: number) {
    const name = names[participantId]?.trim();
    if (!name) return;
    await fetch(`/api/bids/${bidId}/meetings/${meetingId}/participants/${participantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    onSaved();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Users className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        {participants.map((p) => (
          <span key={p.id} className="text-xs bg-zinc-100 dark:bg-zinc-700 px-2 py-0.5 rounded-full text-zinc-700 dark:text-zinc-300">
            {p.speakerLabel && p.name === `Speaker ${p.speakerLabel.replace("SPEAKER_", "")}`
              ? <span className="text-zinc-400">{p.speakerLabel}</span>
              : p.name}
          </span>
        ))}
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline"
        >
          Name speakers
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" /> Name speakers
      </p>
      <div className="grid grid-cols-2 gap-2">
        {participants.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0 w-20">{p.speakerLabel ?? "—"}</span>
            <input
              value={names[p.id] ?? ""}
              onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))}
              onBlur={() => saveName(p.id)}
              placeholder="Full name"
              className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => { setEditing(false); onSaved(); }}
        className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 flex items-center gap-1"
      >
        <X className="h-3 w-3" /> Done naming
      </button>
    </div>
  );
}

// ── Action Items Panel ────────────────────────────────────────────────────────

function ActionItemsPanel({
  bidId,
  meetingId,
  items,
  onReload,
}: {
  bidId: number;
  meetingId: number;
  items: ActionItem[];
  onReload: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<ActionStatus | "ALL">("ALL");

  const filtered = filter === "ALL" ? items : items.filter((i) => i.status === filter);

  async function updateStatus(item: ActionItem, status: ActionStatus) {
    await fetch(`/api/bids/${bidId}/meetings/${meetingId}/action-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onReload();
  }

  async function deleteItem(id: number) {
    await fetch(`/api/bids/${bidId}/meetings/${meetingId}/action-items/${id}`, {
      method: "DELETE",
    });
    onReload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["ALL", "OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {f === "ALL" ? "All" : f === "IN_PROGRESS" ? "In Progress" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {showAdd && (
        <AddActionItemForm
          bidId={bidId}
          meetingId={meetingId}
          onSaved={() => { setShowAdd(false); onReload(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4 text-center">
          {filter === "ALL" ? "No action items yet" : `No ${filter.toLowerCase().replace("_", " ")} items`}
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`rounded border px-3 py-2.5 ${
              item.status === "CLOSED"
                ? "border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-800/30 opacity-60"
                : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.status === "CLOSED" ? "line-through text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                  {item.description}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {item.assignedToName && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      → {item.assignedToName}
                    </span>
                  )}
                  {item.dueDate && (
                    <span className={`text-xs flex items-center gap-0.5 ${
                      new Date(item.dueDate) < new Date() && item.status !== "CLOSED"
                        ? "text-red-500 dark:text-red-400"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}>
                      <Clock className="h-3 w-3" />
                      {new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                  <span className={`text-xs font-medium ${PRIORITY_CONFIG[item.priority].color}`}>
                    {PRIORITY_CONFIG[item.priority].label}
                  </span>
                </div>
                {item.sourceText && (
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 italic mt-1 truncate">
                    &ldquo;{item.sourceText}&rdquo;
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <select
                  value={item.status}
                  onChange={(e) => updateStatus(item, e.target.value as ActionStatus)}
                  className="text-xs rounded border border-zinc-200 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {ACTION_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => deleteItem(item.id)}
                  className="p-1 text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Add Action Item Form ──────────────────────────────────────────────────────

function AddActionItemForm({
  bidId,
  meetingId,
  onSaved,
  onCancel,
}: {
  bidId: number;
  meetingId: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!description.trim()) return;
    setSaving(true);
    await fetch(`/api/bids/${bidId}/meetings/${meetingId}/action-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        assignedToName: assignedTo || null,
        dueDate: dueDate || null,
        priority,
      }),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800 space-y-2">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Describe the action required…"
        className="w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          placeholder="Assigned to"
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-2 py-1 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!description.trim() || saving}
          className="text-xs px-3 py-1 rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? "Saving…" : "Add Item"}
        </button>
      </div>
    </div>
  );
}

// ── All Action Items View ─────────────────────────────────────────────────────

function AllActionItemsView({
  bidId,
  meetings,
  onReload,
}: {
  bidId: number;
  meetings: MeetingSummary[];
  onReload: () => void;
}) {
  const [items, setItems] = useState<(ActionItem & { meetingTitle: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActionStatus | "ALL">("OPEN");

  useEffect(() => {
    async function load() {
      const results = await Promise.all(
        meetings.map(async (m) => {
          const res = await fetch(`/api/bids/${bidId}/meetings/${m.id}/action-items`);
          if (!res.ok) return [];
          const data = await res.json();
          return data.actionItems.map((a: ActionItem) => ({
            ...a,
            meetingTitle: m.title,
          }));
        })
      );
      setItems(results.flat().sort((a, b) => {
        const pOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (pOrder[a.priority as Priority] ?? 2) - (pOrder[b.priority as Priority] ?? 2);
      }));
      setLoading(false);
    }
    if (meetings.length > 0) load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setLoading(false);
  }, [bidId, meetings]);

  const filtered = filter === "ALL" ? items : items.filter((i) => i.status === filter);

  async function updateStatus(
    item: ActionItem & { meetingTitle: string },
    status: ActionStatus
  ) {
    await fetch(`/api/bids/${bidId}/meetings/${item.meetingId}/action-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setItems((prev) =>
      prev.map((i) => i.id === item.id ? { ...i, status, closedAt: status === "CLOSED" ? new Date().toISOString() : null } : i)
    );
    onReload();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading action items…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(["ALL", "OPEN", "IN_PROGRESS", "CLOSED", "DEFERRED"] as const).map((f) => {
          const count = f === "ALL" ? items.length : items.filter((i) => i.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {f === "ALL" ? "All" : f === "IN_PROGRESS" ? "In Progress" : f.charAt(0) + f.slice(1).toLowerCase()}
              <span className="opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
          No {filter === "ALL" ? "" : filter.toLowerCase().replace("_", " ") + " "}action items
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          <div
            key={`${item.meetingId}-${item.id}`}
            className={`rounded border px-3 py-2.5 ${
              item.status === "CLOSED"
                ? "border-zinc-100 opacity-50 dark:border-zinc-800"
                : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.status === "CLOSED" ? "line-through text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                  {item.description}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">{item.meetingTitle}</span>
                  {item.assignedToName && <span>· → {item.assignedToName}</span>}
                  {item.dueDate && (
                    <span className={new Date(item.dueDate) < new Date() && item.status !== "CLOSED" ? "text-red-500 dark:text-red-400" : ""}>
                      · Due {new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                  <span className={`font-medium ${PRIORITY_CONFIG[item.priority].color}`}>
                    · {PRIORITY_CONFIG[item.priority].label}
                  </span>
                </div>
              </div>
              <select
                value={item.status}
                onChange={(e) => updateStatus(item, e.target.value as ActionStatus)}
                className="text-xs rounded border border-zinc-200 bg-white px-1.5 py-0.5 shrink-0 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {ACTION_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
