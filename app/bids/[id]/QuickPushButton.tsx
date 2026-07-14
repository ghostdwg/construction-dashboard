"use client";

// Quick Push — "Award + Push to Procore" button rendered on the bid overview page.
//
// Behaviour:
//   1. On mount: fetches /api/bids/[id]/procore-quick-push/status for preflight info
//   2. Button click: shows confirm dialog with adaptive copy
//   3. On confirm: POST to /api/bids/[id]/procore-quick-push with SSE streaming
//   4. Renders a step checklist that updates in real time
//   5. On complete/failed: shows final state; never auto-retries

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react";
import type {
  StepName,
  StepState,
  StepResults,
  SseStepEvent,
  SseCompleteEvent,
  SseFailedEvent,
} from "@/lib/services/procore/quickPushTypes";
import { STEP_NAMES, emptyStepResults } from "@/lib/services/procore/quickPushTypes";

const STEP_LABELS: Record<StepName, string> = {
  award: "Award bid",
  create_project: "Create / link Procore project",
  vendors: "Push vendors to company directory",
  submittals: "Push submittal register",
  schedule: "Submit schedule for import",
  budget: "Push budget lines",
  confirm: "Verify Procore project",
};

type StatusInfo = {
  bidStatus: string;
  procoreProjectId: string | null;
  credsOk: boolean;
  counts: {
    vendors: number;
    submittals: number;
    scheduleActivities: number;
    budgetLines: number;
  };
};

type RunState = "idle" | "confirming" | "running" | "complete" | "failed";

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") return <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />;
  if (state === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />;
  if (state === "done_with_errors") return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-warning)]" />;
  if (state === "skipped") return <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />;
  if (state === "failed") return <AlertCircle className="w-3.5 h-3.5 text-[var(--color-danger)]" />;
  return <div className="w-3.5 h-3.5 rounded-full border border-[rgba(255,255,255,0.15)]" />;
}

function StepRow({
  name,
  result,
}: {
  name: StepName;
  result: { state: StepState; detail?: string; errors?: string[]; error?: string; procoreProjectId?: string; created?: number; updated?: number; skipped?: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = result.errors && result.errors.length > 0;
  const isTerminal = ["done", "done_with_errors", "skipped", "failed"].includes(result.state);

  const detail = result.detail
    ?? (result.procoreProjectId && (result.state === "done" || result.state === "skipped")
      ? `Project ${result.procoreProjectId}`
      : undefined)
    ?? (result.error)
    ?? (isTerminal && (result.created !== undefined || result.updated !== undefined)
      ? [
          result.created !== undefined && result.created > 0 ? `${result.created} created` : null,
          result.updated !== undefined && result.updated > 0 ? `${result.updated} updated` : null,
          result.skipped !== undefined && result.skipped > 0 ? `${result.skipped} skipped` : null,
        ].filter(Boolean).join(", ")
      : undefined);

  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-2 cursor-default"
        onClick={hasErrors ? () => setExpanded((e) => !e) : undefined}
        style={{ cursor: hasErrors ? "pointer" : "default" }}
      >
        <StepIcon state={result.state} />
        <span
          className="text-xs"
          style={{
            color:
              result.state === "pending"
                ? "var(--color-text-dim)"
                : result.state === "failed"
                ? "var(--color-danger)"
                : result.state === "done_with_errors"
                ? "var(--color-warning)"
                : result.state === "skipped"
                ? "var(--color-text-dim)"
                : "var(--color-text-primary)",
          }}
        >
          {STEP_LABELS[name]}
        </span>
        {detail && (
          <span className="text-[11px] text-[var(--color-text-dim)] truncate max-w-[200px]">
            — {detail}
          </span>
        )}
        {hasErrors && (
          <button className="ml-auto flex items-center gap-0.5 text-[10px] text-[var(--color-warning)]">
            {result.errors!.length} error{result.errors!.length !== 1 ? "s" : ""}
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && hasErrors && (
        <div className="ml-5 space-y-0.5">
          {result.errors!.slice(0, 10).map((e, i) => (
            <p key={i} className="text-[10px] text-[var(--color-warning)] font-mono">{e}</p>
          ))}
          {result.errors!.length > 10 && (
            <p className="text-[10px] text-[var(--color-text-dim)]">
              …and {result.errors!.length - 10} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function QuickPushButton({ bidId }: { bidId: number }) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [stepResults, setStepResults] = useState<StepResults>(emptyStepResults());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [finalProjectId, setFinalProjectId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}/procore-quick-push/status`);
      if (res.ok) {
        const data = (await res.json()) as StatusInfo;
        setStatus(data);
        setFinalProjectId(data.procoreProjectId);
      }
    } catch {
      // non-fatal — button just stays hidden
    }
  }, [bidId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const runPush = useCallback(async () => {
    setRunState("running");
    setStepResults(emptyStepResults());
    setErrorMsg(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/bids/${bidId}/procore-quick-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(json.error ?? `HTTP ${res.status}`);
        setRunState("failed");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";

        for (const block of blocks) {
          const lines = block.split("\n");
          let eventName = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            if (line.startsWith("data: ")) dataStr = line.slice(6);
          }
          if (!dataStr) continue;
          try {
            const payload = JSON.parse(dataStr) as SseStepEvent | SseCompleteEvent | SseFailedEvent;
            if (eventName === "step") {
              const ev = payload as SseStepEvent;
              setStepResults((prev) => ({
                ...prev,
                [ev.step]: {
                  ...prev[ev.step],
                  state: ev.state,
                  detail: ev.detail,
                  procoreProjectId: ev.procoreProjectId,
                  linkedExisting: ev.linkedExisting,
                  created: ev.created,
                  updated: ev.updated,
                  skipped: ev.skipped,
                  errors: ev.errors,
                  importId: ev.importId,
                  activityCount: ev.activityCount,
                  procoreStatus: ev.procoreStatus,
                  error: ev.error,
                  httpStatus: ev.httpStatus,
                },
              }));
              if (ev.procoreProjectId) setFinalProjectId(ev.procoreProjectId);
            } else if (eventName === "complete") {
              const ev = payload as SseCompleteEvent;
              setFinalProjectId(ev.procoreProjectId);
              setStepResults(ev.stepResults);
              setRunState("complete");
            } else if (eventName === "failed") {
              const ev = payload as SseFailedEvent;
              setErrorMsg(ev.error);
              setStepResults(ev.stepResults);
              setRunState("failed");
            }
          } catch {
            // skip malformed SSE frame
          }
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      setErrorMsg(err instanceof Error ? err.message : "Connection error");
      setRunState("failed");
    }
  }, [bidId]);

  if (!status) return null; // still fetching — avoid flash

  if (!status.credsOk) {
    return (
      <div
        className="rounded-lg border px-4 py-3 flex items-center gap-3"
        style={{ background: "var(--color-bg-elevated)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <span className="text-[11px] font-mono uppercase tracking-[0.07em] text-[var(--color-text-dim)]">
          Procore not connected
        </span>
        <a
          href="/settings"
          className="text-[11px] text-[var(--color-accent)] hover:underline"
        >
          Connect in Settings →
        </a>
      </div>
    );
  }

  const { counts, bidStatus, procoreProjectId } = status;
  const isLocked = bidStatus === "lost" || bidStatus === "cancelled";
  const isRunning = runState === "running";
  const showChecklist = runState !== "idle" && runState !== "confirming";

  return (
    <div
      className="rounded-lg border p-4 space-y-3"
      style={{
        background: "var(--color-bg-elevated)",
        borderColor: runState === "complete"
          ? "rgba(6,182,212,0.3)"
          : runState === "failed"
          ? "rgba(239,68,68,0.25)"
          : "var(--color-border-accent)",
        boxShadow:
          runState === "idle" || runState === "confirming"
            ? "var(--color-border-glow)"
            : "none",
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            Quick Push — Award → Procore
          </span>
        </div>
        {/* Pre-flight status badge */}
        {runState === "idle" && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium font-mono"
            style={{
              background: procoreProjectId
                ? "rgba(6,182,212,0.1)"
                : "rgba(45,123,255,0.1)",
              color: procoreProjectId ? "var(--color-success)" : "var(--color-accent)",
              border: `1px solid ${procoreProjectId ? "rgba(6,182,212,0.2)" : "rgba(45,123,255,0.2)"}`,
            }}
          >
            {procoreProjectId ? "Pushed ✓" : "Ready to push"}
          </span>
        )}

        {runState === "idle" && (
          <button
            disabled={isLocked}
            onClick={() => setRunState("confirming")}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border transition-all"
            style={{
              background: isLocked ? "transparent" : "var(--color-accent)",
              color: isLocked ? "var(--color-text-dim)" : "var(--color-text-inverse)",
              borderColor: isLocked ? "rgba(255,255,255,0.1)" : "transparent",
              cursor: isLocked ? "not-allowed" : "pointer",
            }}
            title={isLocked ? `Bid is ${bidStatus} — cannot award` : undefined}
          >
            <Zap className="w-3 h-3" />
            {bidStatus === "awarded" ? "Push to Procore" : "Award & Push"}
          </button>
        )}

        {(runState === "complete" || runState === "failed") && (
          <button
            onClick={() => {
              setRunState("idle");
              setErrorMsg(null);
              loadStatus();
            }}
            className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Confirm dialog */}
      {runState === "confirming" && (
        <div
          className="rounded-md border p-3 space-y-3 text-xs"
          style={{
            background: "var(--color-bg-surface)",
            borderColor: "var(--color-border)",
          }}
        >
          <p className="text-[var(--color-text-secondary)] leading-relaxed">
            This will, in order:
          </p>
          <ol className="list-decimal list-inside space-y-1 text-[var(--color-text-secondary)]">
            {bidStatus === "awarded"
              ? <li>Already awarded — <span className="text-[var(--color-text-dim)]">skipped</span></li>
              : <li>Mark this bid as <strong className="text-[var(--color-text-primary)]">awarded</strong></li>
            }
            {procoreProjectId
              ? <li>Use already-linked Procore project <span className="font-mono text-[var(--color-accent)]">{procoreProjectId}</span></li>
              : <li>Create (or link) a Procore project for this bid</li>
            }
            <li>Push <strong>{counts.vendors}</strong> vendor{counts.vendors !== 1 ? "s" : ""} to the company directory</li>
            <li>Push <strong>{counts.submittals}</strong> submittal{counts.submittals !== 1 ? "s" : ""} to the project register</li>
            <li>Submit the schedule ({counts.scheduleActivities} activities) for import</li>
            <li>Push <strong>{counts.budgetLines}</strong> budget line{counts.budgetLines !== 1 ? "s" : ""}</li>
            <li>Verify and link the Procore project</li>
          </ol>
          <p className="text-[var(--color-text-dim)] leading-relaxed">
            Steps that are already done are skipped. If a step fails, the run stops and{" "}
            <strong>nothing retries without you clicking again</strong>. The award itself is not undone by a Procore failure.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={runPush}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "var(--color-accent)",
                color: "var(--color-text-inverse)",
              }}
            >
              Award & Push
            </button>
            <button
              onClick={() => setRunState("idle")}
              className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Progress modal overlay */}
      {showChecklist && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl border p-5 space-y-4"
            style={{
              background: "var(--color-bg-elevated)",
              borderColor: runState === "complete"
                ? "rgba(6,182,212,0.3)"
                : runState === "failed"
                ? "rgba(239,68,68,0.25)"
                : "var(--color-border-accent)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isRunning && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />}
                {runState === "complete" && <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />}
                {runState === "failed" && <AlertCircle className="w-4 h-4 text-[var(--color-danger)]" />}
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {isRunning ? "Pushing to Procore…" : runState === "complete" ? "Push Complete" : "Push Failed"}
                </span>
              </div>
              {!isRunning && (
                <button
                  onClick={() => { setRunState("idle"); setErrorMsg(null); loadStatus(); }}
                  className="text-lg leading-none text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors"
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>

            {/* Step list */}
            <div className="space-y-2">
              {STEP_NAMES.map((name) => (
                <StepRow key={name} name={name} result={stepResults[name]} />
              ))}
            </div>

            {/* Running footer */}
            {isRunning && (
              <p className="text-[11px] text-[var(--color-text-dim)]">
                Running… do not close this page.
              </p>
            )}

            {/* Success footer */}
            {runState === "complete" && (
              <div
                className="flex items-center gap-2 rounded px-3 py-2 text-xs font-medium"
                style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "var(--color-success)" }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Push complete
                {finalProjectId && (
                  <span className="text-[var(--color-text-dim)] font-normal font-mono ml-1">
                    — Project {finalProjectId}
                  </span>
                )}
              </div>
            )}

            {/* Failure footer */}
            {runState === "failed" && (
              <div className="space-y-2.5">
                {errorMsg && (
                  <div
                    className="flex items-start gap-2 rounded px-3 py-2 text-xs"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--color-danger)" }}
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setStepResults(emptyStepResults()); setErrorMsg(null); runPush(); }}
                    className="btn-primary-sm flex items-center gap-1.5"
                  >
                    <Zap className="w-3 h-3" />
                    Retry Push
                  </button>
                  <p className="text-[10px] text-[var(--color-text-dim)]">
                    Completed steps are skipped on retry.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
