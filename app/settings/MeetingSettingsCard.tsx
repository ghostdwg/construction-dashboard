"use client";

// Phase 5D — Meeting Intelligence settings
//
// AssemblyAI API key for cloud transcription with speaker diarization.
// Without a key, users can still paste transcripts manually.

import { useEffect, useState } from "react";

export default function MeetingSettingsCard() {
  const [assemblyKey, setAssemblyKey] = useState("");
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/app")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        const val = data["ASSEMBLYAI_API_KEY"] ?? "";
        setMaskedKey(val ? `••••${val.slice(-4)}` : null);
      });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/app", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ASSEMBLYAI_API_KEY: assemblyKey }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Save failed");
      return;
    }
    setMaskedKey(assemblyKey ? `••••${assemblyKey.slice(-4)}` : null);
    setAssemblyKey("");
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function clear() {
    await fetch("/api/settings/app", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ASSEMBLYAI_API_KEY: "" }),
    });
    setMaskedKey(null);
    setAssemblyKey("");
    setEditing(false);
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Meeting Transcription
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          AssemblyAI transcribes audio recordings with speaker diarization — it identifies
          who said what, which Claude uses to extract accurate action items and decisions.
          Without a key, paste transcripts manually.
        </p>
      </div>

      <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AssemblyAI API Key</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            $0.15/hr · speaker diarization included · US/EU data residency options
          </p>
        </div>
        {!editing ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
              {maskedKey ?? <span className="text-zinc-400 dark:text-zinc-500 italic font-sans">Not set — manual transcript only</span>}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 underline"
            >
              {maskedKey ? "Replace" : "Add key"}
            </button>
            {maskedKey && (
              <button
                onClick={clear}
                className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 underline"
              >
                Clear
              </button>
            )}
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={assemblyKey}
              onChange={(e) => setAssemblyKey(e.target.value)}
              placeholder="Paste AssemblyAI API key"
              className="flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              onKeyDown={(e) => e.key === "Enter" && save()}
              autoFocus
            />
            <button
              onClick={save}
              disabled={!assemblyKey.trim() || saving}
              className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setAssemblyKey(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            >
              Cancel
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <div className="rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-4 py-3 space-y-1.5">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          How meeting transcription works
        </p>
        <ol className="text-xs text-zinc-600 dark:text-zinc-400 list-decimal pl-4 space-y-1">
          <li>Upload audio from the Meetings tab on any bid (MP3, M4A, WAV, MP4)</li>
          <li>AssemblyAI transcribes and identifies each speaker (SPEAKER A, SPEAKER B…)</li>
          <li>You resolve speaker labels to real names (John Smith, GC PM)</li>
          <li>Claude analyzes the transcript and extracts action items, decisions, and risks</li>
          <li>Action items become a filterable register with status tracking</li>
        </ol>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
          The key is stored in ASSEMBLYAI_API_KEY. You can also set it in your .env.local file.
        </p>
      </div>
    </section>
  );
}
