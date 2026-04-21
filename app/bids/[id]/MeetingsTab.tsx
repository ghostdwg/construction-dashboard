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
  AlertTriangle,
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
type MeetingStatus = "PENDING" | "UPLOADING" | "TRANSCRIBING" | "ANALYZING" | "READY" | "FAILED";
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
  createdAt: string;
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
  summary: string | null;
  keyDecisions: string[];
  risks: { description: string; severity: string }[];
  followUpItems: string[];
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
  PENDING:      { label: "Pending",      color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  UPLOADING:    { label: "Uploading…",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  TRANSCRIBING: { label: "Transcribing", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  ANALYZING:    { label: "Analyzing",    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  READY:        { label: "Ready",        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  FAILED:       { label: "Failed",       color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
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
  return status === "UPLOADING" || status === "TRANSCRIBING" || status === "ANALYZING";
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MeetingsTab({ bidId }: { bidId: number }) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [view, setView] = useState<"meetings" | "actions">("meetings");

  const loadMeetings = useCallback(async () => {
    const res = await fetch(`/api/bids/${bidId}/meetings`);
    if (res.ok) {
      const data = await res.json();
      setMeetings(data.meetings);
    }
    setLoading(false);
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

      {!loading && view === "actions" && (
        <AllActionItemsView bidId={bidId} meetings={meetings} onReload={loadMeetings} />
      )}

      {!loading && view === "meetings" && meetings.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 py-12 text-center">
          <Mic className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No meetings yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Add a meeting to start capturing transcripts and action items
          </p>
        </div>
      )}

      {!loading && view === "meetings" && meetings.map((m) => (
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
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/bids/${bidId}/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, meetingDate: date, meetingType: type, location }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      onSaved(data.id);
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
      </div>
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
  const statusCfg = STATUS_CONFIG[meeting.status];

  useEffect(() => {
    if (!expanded) return;
    setLoadingDetail(true);
    fetch(`/api/bids/${bidId}/meetings/${meeting.id}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoadingDetail(false); })
      .catch(() => setLoadingDetail(false));
  }, [expanded, bidId, meeting.id]);

  async function deleteMeeting() {
    if (!confirm("Delete this meeting and all its action items?")) return;
    await fetch(`/api/bids/${bidId}/meetings/${meeting.id}`, { method: "DELETE" });
    onReload();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-left"
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
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 pb-4 pt-3">
          {loadingDetail && (
            <div className="flex items-center gap-2 text-sm text-zinc-500 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!loadingDetail && detail && (
            <MeetingDetailPanel
              bidId={bidId}
              detail={detail}
              onReload={() => {
                onReload();
                setLoadingDetail(true);
                fetch(`/api/bids/${bidId}/meetings/${detail.id}`)
                  .then((r) => r.json())
                  .then((d) => { setDetail(d); setLoadingDetail(false); })
                  .catch(() => setLoadingDetail(false));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Meeting Detail Panel ──────────────────────────────────────────────────────

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
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [manualTranscript, setManualTranscript] = useState(detail.transcript ?? "");
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll if actively processing
  useEffect(() => {
    if (!isActive(detail.status as MeetingStatus)) return;
    const timer = setTimeout(() => onReload(), 5000);
    return () => clearTimeout(timer);
  }, [detail.status, onReload]);

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

  const hasTranscript = !!detail.transcript?.trim() || !!manualTranscript.trim();

  return (
    <div className="space-y-4">
      {/* ── Status banner for in-progress states ── */}
      {isActive(detail.status as MeetingStatus) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          {detail.status === "UPLOADING" && "Uploading audio to AssemblyAI…"}
          {detail.status === "TRANSCRIBING" && "Transcribing audio — this takes 1-5 minutes…"}
          {detail.status === "ANALYZING" && "Running Claude analysis on transcript…"}
        </div>
      )}

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

      {/* ── Transcript ── */}
      {activeSection === "transcript" && (
        <div className="space-y-3">
          {!detail.audioFileName && detail.status === "PENDING" && (
            <div className="space-y-2">
              {/* Upload option */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 py-8 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
              >
                <Upload className="h-6 w-6 text-zinc-400" />
                <div className="text-center">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Upload audio file</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">MP3, M4A, WAV, MP4, WEBM · max 500 MB</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    Requires AssemblyAI API key in sidecar/.env
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) uploadAudio(e.target.files[0]); }}
              />
              {uploadError && (
                <p className="text-xs text-amber-600 dark:text-amber-400 px-1">{uploadError}</p>
              )}
              <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">— or —</p>
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
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                  Summary
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {detail.summary}
                </p>
              </div>

              {detail.keyDecisions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                    Key Decisions
                  </p>
                  <ul className="space-y-1">
                    {detail.keyDecisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.risks.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                    Risks Identified
                  </p>
                  <ul className="space-y-1.5">
                    {detail.risks.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                          r.severity === "CRITICAL" ? "text-red-500" :
                          r.severity === "HIGH" ? "text-orange-500" : "text-amber-500"
                        }`} />
                        <span className="text-zinc-700 dark:text-zinc-300">{r.description}</span>
                        <span className={`text-[10px] font-medium ml-auto shrink-0 ${
                          r.severity === "CRITICAL" ? "text-red-500" :
                          r.severity === "HIGH" ? "text-orange-500" : "text-amber-500"
                        }`}>{r.severity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.followUpItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                    Follow-up Items
                  </p>
                  <ul className="space-y-1">
                    {detail.followUpItems.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  Analyzed {detail.analyzedAt ? fmtDate(detail.analyzedAt) : ""}
                </p>
                <button
                  onClick={runAnalysis}
                  disabled={analyzing}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1"
                >
                  <Sparkles className="h-3 w-3" /> Re-analyze
                </button>
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
