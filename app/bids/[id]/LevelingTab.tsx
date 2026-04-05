"use client";

import { useRef, useState } from "react";
import { TierBadge } from "@/app/subcontractors/[id]/SubIntelligencePanel";

// ---- Types ----

type Sub = {
  id: number;
  company: string;
  tier: string;
};

type EstimateUpload = {
  id: number;
  subcontractorId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  scopeLines: string;
  parseStatus: string;
  parseError: string | null;
  uploadedAt: Date | string;
};

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done"; upload: EstimateUpload }
  | { status: "error"; message: string };

// ---- Helpers ----

function scopeLineCount(scopeLines: string): number {
  try {
    const parsed = JSON.parse(scopeLines);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SubUploadRow({
  bidId,
  sub,
  initial,
}: {
  bidId: number;
  sub: Sub;
  initial: EstimateUpload | null;
}) {
  const [upload, setUpload] = useState<EstimateUpload | null>(initial);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setState({ status: "uploading" });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("subcontractorId", String(sub.id));

    try {
      const res = await fetch(`/api/bids/${bidId}/estimates`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok && res.status !== 422) {
        setState({ status: "error", message: data.error ?? "Upload failed" });
        return;
      }
      setUpload(data);
      setState({ status: "done", upload: data });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  const current = upload;

  return (
    <div className="flex items-start justify-between py-3 border-b border-zinc-100 last:border-0">
      {/* Sub info */}
      <div className="flex items-center gap-3 w-1/3">
        <div>
          <p className="text-sm font-medium text-zinc-800">{sub.company}</p>
        </div>
        <TierBadge tier={sub.tier} />
      </div>

      {/* Status + actions */}
      <div className="flex-1 flex items-center justify-between gap-4">
        {!current || current.parseStatus === "failed" ? (
          <>
            <div>
              {current?.parseStatus === "failed" ? (
                <p className="text-xs text-red-600">
                  Parse failed:{" "}
                  <span className="font-normal">{current.parseError}</span>
                </p>
              ) : (
                <p className="text-xs text-zinc-400">No estimate uploaded</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {state.status === "uploading" && (
                <span className="text-xs text-zinc-400">Uploading…</span>
              )}
              {state.status === "error" && (
                <span className="text-xs text-red-500">{state.message}</span>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={state.status === "uploading"}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {current?.parseStatus === "failed" ? "Re-upload" : "Upload estimate"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </>
        ) : current.parseStatus === "processing" ? (
          <p className="text-xs text-amber-600">Processing…</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-green-700 font-medium">
                Ready — {scopeLineCount(current.scopeLines)} scope lines
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {current.fileName} &middot;{" "}
                {formatFileSize(current.fileSize)} &middot;{" "}
                {new Date(String(current.uploadedAt)).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={state.status === "uploading"}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
            >
              {state.status === "uploading" ? "Uploading…" : "Replace"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---- Main component ----

export default function LevelingTab({
  bidId,
  subs,
  initialUploads,
}: {
  bidId: number;
  subs: Sub[];
  initialUploads: EstimateUpload[];
}) {
  const uploadMap = new Map(initialUploads.map((u) => [u.subcontractorId, u]));

  return (
    <div className="flex flex-col gap-8">
      {/* ── Section 1: Estimate Uploads ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-1">
          Estimate Uploads
        </h2>
        <p className="text-xs text-zinc-400 mb-4">
          Upload estimates for subs with received, reviewing, or accepted
          status. Pricing is stripped before any AI use.
        </p>

        {subs.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No subs with estimates received yet. Update RFQ status on the Subs
            tab.
          </p>
        ) : (
          <div className="rounded-md border border-zinc-200 px-4">
            {subs.map((sub) => (
              <SubUploadRow
                key={sub.id}
                bidId={bidId}
                sub={sub}
                initial={uploadMap.get(sub.id) ?? null}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Project Baseline ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Project Baseline
        </h2>
        <div className="rounded-md border border-zinc-200 p-6 text-center">
          <p className="text-sm text-zinc-400">
            Spec book or drawing index — coming in Module 6b
          </p>
        </div>
      </section>

      {/* ── Section 3: Scope Matrix ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Scope Matrix
        </h2>
        <div className="rounded-md border border-zinc-200 p-6 text-center">
          <p className="text-sm text-zinc-400">
            Scope leveling — coming in Module 6b
          </p>
        </div>
      </section>
    </div>
  );
}
