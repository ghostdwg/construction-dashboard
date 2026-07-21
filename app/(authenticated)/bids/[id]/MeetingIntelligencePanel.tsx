"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, LockKeyhole, Play, Upload } from "lucide-react";

type Segment = {
  id: number;
  segmentIndex: number;
  startSec: number | null;
  originalSpeakerLabel: string;
  currentSpeakerLabel: string;
  currentText: string;
};

type Candidate = {
  id: number;
  candidateType: string;
  rawText: string;
  draftText: string;
  evidenceExcerpt: string;
  speakerLabel: string;
  startSec: number | null;
  confidence: number | null;
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
  artifact: IntelligenceArtifact | null;
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
          This v1 panel never sends audio, transcripts, or project data to external AI.
          Its processor accepts explicit fixture text for deterministic development only;
          it does not transcribe or understand the uploaded recording.
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
            <p className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deterministic local processing is in progress.
            </p>
          )}

          {data.artifact?.state === "FAILED" && (
            <p className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Processing failed{data.artifact.errorMessage ? `: ${data.artifact.errorMessage}` : "."}
              No candidate was published.
            </p>
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

          {data.artifact && ["READY_FOR_REVIEW", "PUBLISHED"].includes(data.artifact.state) && (
            <div className="space-y-2">
              <div>
                <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Reviewable task ledger ({data.artifact.candidates.length})
                </h4>
                {data.artifact.candidates.length === 0 && (
                  <p className="text-xs text-zinc-500">No explicitly tagged candidates were found.</p>
                )}
              </div>
              {data.artifact.candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  base={base}
                  candidate={candidate}
                  onChanged={async (published) => {
                    await load();
                    if (published) onPublished?.();
                  }}
                />
              ))}
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
  base,
  candidate,
  onChanged,
}: {
  base: string;
  candidate: Candidate;
  onChanged: (published: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(candidate.draftText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <article className="space-y-2 rounded border border-zinc-200 p-3 text-xs dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {candidate.candidateType.replaceAll("_", " ")}
        </span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {candidate.reviewState.replaceAll("_", " ")}
        </span>
        <span className="text-[10px] text-zinc-400">
          {candidate.speakerLabel} · {secondsLabel(candidate.startSec)}
          {candidate.confidence != null ? ` · ${Math.round(candidate.confidence * 100)}%` : ""}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={candidate.reviewState === "PUBLISHED"}
        rows={2}
        className="w-full rounded border border-zinc-300 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-70"
      />
      <p className="text-[11px] text-zinc-500">Evidence: {candidate.evidenceExcerpt}</p>
      <div className="flex flex-wrap gap-1.5">
        {candidate.reviewState !== "PUBLISHED" && (
          <>
            <button
              onClick={() => void mutate("", "PATCH", { action: "EDIT", editedText: text })}
              disabled={busy || !text.trim() || text === candidate.draftText}
              className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-600"
            >
              Save edit
            </button>
            <button
              onClick={() => void mutate("", "PATCH", { action: "ACCEPT" })}
              disabled={busy}
              className="rounded bg-emerald-700 px-2 py-1 text-white disabled:opacity-40"
            >
              Accept
            </button>
            <button
              onClick={() => void mutate("", "PATCH", { action: "REJECT" })}
              disabled={busy}
              className="rounded border border-zinc-300 px-2 py-1 text-zinc-600 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300"
            >
              Reject
            </button>
          </>
        )}
        {candidate.reviewState === "ACCEPTED" && (
          <button
            onClick={() => void mutate("/publish", "POST")}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <Check className="h-3 w-3" /> Publish to Action Items
          </button>
        )}
        {candidate.reviewState === "PUBLISHED" && (
          <span className="text-emerald-700 dark:text-emerald-300">
            Published{candidate.publishedActionItem ? ` as Action Item #${candidate.publishedActionItem.id}` : ""}
          </span>
        )}
      </div>
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
    </article>
  );
}
