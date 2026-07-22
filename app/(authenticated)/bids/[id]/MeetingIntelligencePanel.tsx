"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, LockKeyhole, Play, Upload } from "lucide-react";
import {
  candidateDispositionCounts,
  filterMeetingIntelligenceCandidates,
  groupMeetingIntelligenceCandidates,
  isTaskEligibleCandidateType,
} from "@/lib/services/meetingIntelligence/reviewLedger";

type Segment = {
  id: number;
  segmentIndex: number;
  startSec: number | null;
  originalSpeakerLabel: string;
  currentSpeakerLabel: string;
  currentText: string;
  endSec: number | null;
};

type Candidate = {
  id: number;
  segmentId: number | null;
  candidateType: string;
  rawText: string;
  draftText: string;
  evidenceExcerpt: string;
  speakerLabel: string;
  startSec: number | null;
  endSec: number | null;
  confidence: number | null;
  dueDate: string | null;
  reviewState: string;
  publishedActionItem: { id: number; description: string; status: string } | null;
};

type IntelligenceArtifact = {
  id: number;
  state: string;
  sourceReference: string;
  sourceKind: string;
  transcriptText: string | null;
  transcriptConfidence: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  segments: Segment[];
  candidates: Candidate[];
};

type IntelligenceResponse = {
  state: string;
  sourceMediaAvailable: boolean;
  canQueue: boolean;
  transcriptStatus: string;
  confidentiality: "LOCAL_ONLY";
  processorKind: "DETERMINISTIC_LOCAL_DEV";
  workerJob: {
    id: number;
    status: string;
    attempt: number;
    maxAttempts: number;
    workerId: string | null;
    progressStage: string | null;
    progressPercent: number | null;
    leasedAt: string | null;
    leaseExpiresAt: string | null;
    lastHeartbeatAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  artifact: IntelligenceArtifact | null;
  participants: Array<{ id: number; name: string; role: string | null; company: string | null }>;
};

function secondsLabel(seconds: number | null): string {
  if (seconds == null) return "timestamp unknown";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function MeetingIntelligencePanel({
  bidId,
  meetingId,
  onPublished,
}: {
  bidId: number;
  meetingId: number;
  onPublished?: () => void;
}) {
  const base = `/api/bids/${bidId}/meetings/${meetingId}/intelligence`;
  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [fixtureText, setFixtureText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [actionabilityFilter, setActionabilityFilter] = useState<"all" | "task" | "context">("all");
  const [dueFilter, setDueFilter] = useState<"all" | "missing" | "overdue" | "next7">("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(base);
      const json = (await response.json()) as IntelligenceResponse & { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Meeting Intelligence load failed");
      setData(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Meeting Intelligence load failed");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data || !["QUEUED", "PROCESSING"].includes(data.state)) return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [data, load]);

  const candidates = useMemo(() => data?.artifact?.candidates ?? [], [data?.artifact?.candidates]);
  const filteredCandidates = useMemo(() => filterMeetingIntelligenceCandidates(candidates, {
    state: stateFilter,
    type: typeFilter,
    actionability: actionabilityFilter,
    due: dueFilter,
    search,
  }), [actionabilityFilter, candidates, dueFilter, search, stateFilter, typeFilter]);
  const candidateGroups = useMemo(() => groupMeetingIntelligenceCandidates(
    filteredCandidates,
    data?.artifact?.segments ?? [],
  ), [data?.artifact?.segments, filteredCandidates]);
  const dispositionCounts = useMemo(() => candidateDispositionCounts(candidates), [candidates]);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${base}/${path}`, {
        method: "POST",
        ...(body
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Action failed");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function batchReview(action: "ACCEPT" | "REJECT") {
    if (!data?.artifact || selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${base}/candidates/batch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId: data.artifact.id, candidateIds: selectedIds, action }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Batch review failed");
      setSelectedIds([]);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Batch review failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading review ledger…</p>;
  }

  return (
    <section className="space-y-3">
      <div className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
        <p className="flex items-center gap-1.5 font-semibold">
          <LockKeyhole className="h-3.5 w-3.5" /> Local Only confidentiality boundary
        </p>
        <p className="mt-1">
          Audio, transcripts, and project data stay inside the application and its private
          local-worker boundary. The durable queue calls no external AI service. The optional
          fixture processor below remains deterministic development tooling and does not
          transcribe or understand the uploaded recording.
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <StatusFact label="Processing state" value={data.state.replaceAll("_", " ")} />
            <StatusFact
              label="Source media"
              value={data.sourceMediaAvailable ? "Available" : "Not available"}
            />
            <StatusFact
              label="Transcript artifact"
              value={data.transcriptStatus.replaceAll("_", " ")}
            />
          </div>

          {data.state === "NOT_STARTED" && !data.sourceMediaAvailable && (
            <p className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <Upload className="h-4 w-4" /> Meeting Intelligence is not ready: upload meeting media first.
            </p>
          )}

          {data.canQueue && (
            <button
              onClick={() => void post("queue")}
              disabled={busy}
              className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Queue local review artifact
            </button>
          )}

          {data.artifact?.state === "QUEUED" && (
            <div className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-700">
              {data.workerJob?.status === "QUEUED" && (
                <p className="rounded border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
                  Waiting for a private local worker to poll the durable queue. The worker may be offline or busy.
                </p>
              )}
              <div>
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Deterministic/dev fixture input
                </p>
                <p className="text-[11px] text-zinc-500">
                  Format: [00:12] SPEAKER_1: ACTION_ITEM: Submit RFI by 2026-07-24
                </p>
              </div>
              <textarea
                value={fixtureText}
                onChange={(event) => setFixtureText(event.target.value)}
                rows={5}
                placeholder="[00:00] SPEAKER_1: DECISION: Use the alternate flashing detail"
                className="w-full rounded border border-zinc-300 bg-white p-2 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void post("process", { artifactId: data.artifact!.id, fixtureText })}
                  disabled={busy || !fixtureText.trim()}
                  className="flex items-center gap-1 rounded bg-violet-700 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Run deterministic processor
                </button>
                <button
                  onClick={() => void post("cancel", { artifactId: data.artifact!.id })}
                  disabled={busy}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {data.artifact?.state === "PROCESSING" && (
            <div className="space-y-2 rounded border border-violet-200 p-3 text-xs text-violet-800 dark:border-violet-900 dark:text-violet-300">
              <p className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {data.workerJob?.status === "QUEUED"
                  ? "Waiting for the next bounded private-worker attempt. The worker may be offline or busy."
                  : "Private local-worker processing is in progress."}
              </p>
              {data.workerJob && (
                <p>
                  Stage: {(data.workerJob.progressStage ?? "claimed").replaceAll("_", " ")}
                  {data.workerJob.progressPercent != null ? ` · ${data.workerJob.progressPercent}%` : ""}
                  {` · attempt ${data.workerJob.attempt} of ${data.workerJob.maxAttempts}`}
                </p>
              )}
              <button
                onClick={() => void post("cancel", { artifactId: data.artifact!.id })}
                disabled={busy}
                className="w-fit rounded border border-violet-300 px-2 py-1 disabled:opacity-40 dark:border-violet-800"
              >
                Cancel processing
              </button>
            </div>
          )}

          {data.artifact?.state === "FAILED" && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Processing failed{data.workerJob?.errorMessage || data.artifact.errorMessage
                  ? `: ${data.workerJob?.errorMessage ?? data.artifact.errorMessage}`
                  : "."} No candidate was published.
              </p>
              <button
                onClick={() => void post("retry", { artifactId: data.artifact!.id })}
                disabled={busy || !data.sourceMediaAvailable}
                className="rounded border border-red-300 px-2 py-1 disabled:opacity-40 dark:border-red-800"
              >
                Retry on private worker
              </button>
            </div>
          )}

          {(data.artifact?.segments.length ?? 0) > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                Transcript segments ({data.artifact!.segments.length})
              </h4>
              {data.artifact!.segments.map((segment) => (
                <SegmentRow key={segment.id} base={base} segment={segment} onChanged={load} />
              ))}
            </div>
          )}

          {data.artifact && ["READY_FOR_REVIEW", "REVIEWED", "PUBLISHED"].includes(data.artifact.state) && (
            <div className="space-y-3">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Reviewable task ledger ({data.artifact.candidates.length})
                </h4>
                <p className="text-[11px] text-zinc-500">
                  Processor suggestions only. A human must review wording, assignment, due date, and priority before publication.
                </p>
                <div className="flex flex-wrap gap-1 text-[10px] text-zinc-500">
                  {["DRAFT", "EDITED", "ACCEPTED", "REJECTED", "PUBLISHED"].map((state) => (
                    <span key={state} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                      {state.replaceAll("_", " ")}: {dispositionCounts[state] ?? 0}
                    </span>
                  ))}
                </div>
                {data.artifact.candidates.length === 0 && (
                  <p className="text-xs text-zinc-500">No deterministic structural candidates were found.</p>
                )}
              </div>
              {data.artifact.candidates.length > 0 && (
                <div className="grid gap-2 rounded border border-zinc-200 p-2 sm:grid-cols-2 lg:grid-cols-5 dark:border-zinc-700">
                  <select aria-label="Disposition filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="rounded border border-zinc-300 bg-white p-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800">
                    <option value="all">All dispositions</option>
                    {["DRAFT", "EDITED", "ACCEPTED", "REJECTED", "PUBLISHED"].map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}
                  </select>
                  <select aria-label="Candidate type filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded border border-zinc-300 bg-white p-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800">
                    <option value="all">All candidate types</option>
                    {[...new Set(data.artifact.candidates.map((candidate) => candidate.candidateType))].sort().map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                  </select>
                  <select aria-label="Actionability filter" value={actionabilityFilter} onChange={(event) => setActionabilityFilter(event.target.value as "all" | "task" | "context")} className="rounded border border-zinc-300 bg-white p-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800">
                    <option value="all">All actionability</option><option value="task">Task eligible</option><option value="context">Context only</option>
                  </select>
                  <select aria-label="Due date filter" value={dueFilter} onChange={(event) => setDueFilter(event.target.value as "all" | "missing" | "overdue" | "next7")} className="rounded border border-zinc-300 bg-white p-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800">
                    <option value="all">All due dates</option><option value="missing">Missing due date</option><option value="overdue">Overdue</option><option value="next7">Next 7 days</option>
                  </select>
                  <input aria-label="Search candidates" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search evidence or wording" className="rounded border border-zinc-300 bg-white p-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800" />
                </div>
              )}
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-violet-200 bg-violet-50 p-2 text-xs dark:border-violet-900 dark:bg-violet-950/30">
                  <span>{selectedIds.length} selected (maximum 50)</span>
                  <button disabled={busy} onClick={() => void batchReview("ACCEPT")} className="rounded bg-emerald-700 px-2 py-1 text-white disabled:opacity-40">Accept selected</button>
                  <button disabled={busy} onClick={() => void batchReview("REJECT")} className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-600">Reject selected</button>
                  <button disabled={busy} onClick={() => setSelectedIds([])} className="px-2 py-1 text-zinc-500">Clear</button>
                </div>
              )}
              {candidateGroups.map((group) => (
                <section key={group.key} className="space-y-2 rounded border border-zinc-300 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-900/20">
                  <div className="space-y-1 border-b border-zinc-200 pb-2 text-[11px] dark:border-zinc-700">
                    <div className="flex flex-wrap gap-2 text-zinc-500">
                      <span className="font-mono">{group.speakerLabel}</span>
                      <span>{secondsLabel(group.startSec)}–{secondsLabel(group.endSec)}</span>
                      {group.confidence != null && <span>{Math.round(group.confidence * 100)}% confidence</span>}
                    </div>
                    <p className="font-medium text-zinc-700 dark:text-zinc-300">Transcript context: {group.segment?.currentText ?? group.evidenceExcerpt}</p>
                    <p className="text-zinc-500">Source evidence: {group.evidenceExcerpt}</p>
                  </div>
                  {group.candidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.id}
                      bidId={bidId}
                      base={base}
                      candidate={candidate}
                      participants={data.participants}
                      selected={selectedIds.includes(candidate.id)}
                      onSelected={(selected) => setSelectedIds((current) => selected
                        ? current.length < 50 ? [...current, candidate.id] : current
                        : current.filter((id) => id !== candidate.id))}
                      onChanged={async (published) => {
                        setSelectedIds((current) => current.filter((id) => id !== candidate.id));
                        await load();
                        if (published) onPublished?.();
                      }}
                    />
                  ))}
                </section>
              ))}
              {data.artifact.candidates.length > 0 && candidateGroups.length === 0 && <p className="text-xs text-zinc-500">No candidates match the current filters.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 font-medium capitalize text-zinc-800 dark:text-zinc-200">{value.toLowerCase()}</p>
    </div>
  );
}

function SegmentRow({
  base,
  segment,
  onChanged,
}: {
  base: string;
  segment: Segment;
  onChanged: () => Promise<void>;
}) {
  const [speaker, setSpeaker] = useState(segment.currentSpeakerLabel);
  const [busy, setBusy] = useState(false);

  async function saveSpeaker() {
    setBusy(true);
    const response = await fetch(`${base}/segments/${segment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speakerLabel: speaker }),
    });
    setBusy(false);
    if (response.ok) await onChanged();
  }

  return (
    <div className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
        <span>{secondsLabel(segment.startSec)}</span>
        <input
          value={speaker}
          onChange={(event) => setSpeaker(event.target.value.toUpperCase())}
          className="w-36 rounded border border-zinc-300 px-1 py-0.5 font-mono dark:border-zinc-600 dark:bg-zinc-800"
          aria-label={`Speaker for segment ${segment.segmentIndex + 1}`}
        />
        <button
          onClick={() => void saveSpeaker()}
          disabled={busy || speaker === segment.currentSpeakerLabel}
          className="rounded border border-zinc-300 px-1.5 py-0.5 disabled:opacity-40 dark:border-zinc-600"
        >
          Correct label
        </button>
        {segment.originalSpeakerLabel !== segment.currentSpeakerLabel && (
          <span>originally {segment.originalSpeakerLabel}</span>
        )}
      </div>
      <p className="mt-1 text-zinc-700 dark:text-zinc-300">{segment.currentText}</p>
    </div>
  );
}

function CandidateRow({
  bidId,
  base,
  candidate,
  participants,
  selected,
  onSelected,
  onChanged,
}: {
  bidId: number;
  base: string;
  candidate: Candidate;
  participants: IntelligenceResponse["participants"];
  selected: boolean;
  onSelected: (selected: boolean) => void;
  onChanged: (published: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(candidate.draftText);
  const [dueDate, setDueDate] = useState(candidate.dueDate?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [assignmentChoice, setAssignmentChoice] = useState<"unset" | "named" | "unassigned">("unset");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState(candidate.candidateType === "RISK" ? "HIGH" : "MEDIUM");
  const taskEligible = isTaskEligibleCandidateType(candidate.candidateType);
  const editable = candidate.reviewState !== "PUBLISHED";
  const draftDirty = text !== candidate.draftText || dueDate !== (candidate.dueDate?.slice(0, 10) ?? "");

  async function mutate(path: string, method: "PATCH" | "POST", body?: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch(`${base}/candidates/${candidate.id}${path}`, {
      method,
      ...(body
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    const json = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(json.error ?? "Action failed");
      return;
    }
    await onChanged(path === "/publish");
  }

  async function publish() {
    await mutate("/publish", "POST", {
      confirmed: true,
      assignmentConfirmed: assignmentChoice !== "unset",
      assignedToName: assignmentChoice === "named" ? assignee : null,
      priority,
    });
  }

  return (
    <article className="space-y-2 rounded border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <input type="checkbox" checked={selected} onChange={(event) => onSelected(event.target.checked)} aria-label={`Select candidate ${candidate.id}`} />
        )}
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {candidate.candidateType.replaceAll("_", " ")}
        </span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {candidate.reviewState.replaceAll("_", " ")}
        </span>
        {!taskEligible && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Context only</span>}
      </div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Task description</label>
      <textarea value={text} onChange={(event) => setText(event.target.value)} disabled={!editable} rows={2} className="w-full rounded border border-zinc-300 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-70" />
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Due date</label>
      <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={!editable} className="w-full rounded border border-zinc-300 bg-white p-2 sm:w-48 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-70" />
      <div className="flex flex-wrap gap-1.5">
        {editable && (
          <>
            <button onClick={() => void mutate("", "PATCH", { action: "EDIT", editedText: text, dueDate: dueDate || null })} disabled={busy || !text.trim() || (text === candidate.draftText && dueDate === (candidate.dueDate?.slice(0, 10) ?? ""))} className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-600">
              Save description and due date
            </button>
            <button title={draftDirty ? "Save description and due date before accepting" : undefined} onClick={() => void mutate("", "PATCH", { action: "ACCEPT" })} disabled={busy || draftDirty} className="rounded bg-emerald-700 px-2 py-1 text-white disabled:opacity-40">Accept</button>
            <button onClick={() => void mutate("", "PATCH", { action: "REJECT" })} disabled={busy} className="rounded border border-zinc-300 px-2 py-1 text-zinc-600 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300">Reject</button>
          </>
        )}
        {candidate.reviewState === "ACCEPTED" && taskEligible && !showPreview && (
          <button onClick={() => setShowPreview(true)} disabled={busy} className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            <Check className="h-3 w-3" /> Review final task preview
          </button>
        )}
        {candidate.reviewState === "ACCEPTED" && !taskEligible && <span className="text-amber-700 dark:text-amber-300">Retained as transcript context; this type cannot publish independently.</span>}
        {candidate.reviewState === "PUBLISHED" && (candidate.publishedActionItem ? (
          <a href={`/bids/${bidId}?tab=tasks`} className="font-medium text-emerald-700 underline dark:text-emerald-300">Open published Action Item #{candidate.publishedActionItem.id}</a>
        ) : <span className="text-emerald-700 dark:text-emerald-300">Published to Action Items</span>)}
      </div>
      {showPreview && candidate.reviewState === "ACCEPTED" && taskEligible && (
        <div className="space-y-3 rounded border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">Final task preview</p>
            <p className="mt-1 text-zinc-700 dark:text-zinc-300">{candidate.draftText}</p>
            <p className="mt-1 text-[11px] text-zinc-500">Due {candidate.dueDate ? new Date(candidate.dueDate).toLocaleDateString() : "date not set"}. Evidence remains linked and immutable.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Assignment confirmation</label>
              <select value={assignmentChoice} onChange={(event) => setAssignmentChoice(event.target.value as "unset" | "named" | "unassigned")} className="w-full rounded border border-zinc-300 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-800">
                <option value="unset">Choose assignment disposition…</option><option value="named">Named assignee</option><option value="unassigned">Explicitly unassigned</option>
              </select>
              {assignmentChoice === "named" && (
                <>
                  <input list={`participant-${candidate.id}`} value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Confirm a person’s name" className="w-full rounded border border-zinc-300 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-800" />
                  <datalist id={`participant-${candidate.id}`}>{participants.map((participant) => <option key={participant.id} value={participant.name}>{[participant.role, participant.company].filter(Boolean).join(" · ")}</option>)}</datalist>
                </>
              )}
              <p className="text-[10px] text-zinc-500">{candidate.speakerLabel} is transcript evidence, not a verified person.</p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Priority</label>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-800">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </div>
          </div>
          <p className="text-[11px] text-zinc-700 dark:text-zinc-300">Publishing is a human-confirmed action. Review the task fields above before continuing.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void publish()} disabled={busy || assignmentChoice === "unset" || (assignmentChoice === "named" && !assignee.trim())} className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-40">Confirm and publish to Action Items</button>
            <button onClick={() => setShowPreview(false)} disabled={busy} className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-600">Back</button>
          </div>
        </div>
      )}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
    </article>
  );
}
