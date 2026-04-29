"use client";

import { useEffect, useState } from "react";
import type { SettingDisplay } from "@/lib/services/settings/appSettingsService";

type HealthResult =
  | { connected: true; device?: string; model?: string }
  | { connected: false; error: string };

type HealthResponse = {
  gpu: HealthResult;
  sidecar: HealthResult;
};

function useInfraSettings() {
  const [items, setItems] = useState<SettingDisplay[]>([]);

  useEffect(() => {
    fetch("/api/settings/app?category=infrastructure")
      .then((r) => r.json())
      .then((data: { items: SettingDisplay[] }) => setItems(data.items ?? []));
  }, []);

  function find(key: string): SettingDisplay | undefined {
    return items.find((i) => i.key === key);
  }

  return { find };
}

function FieldRow({
  label,
  description,
  settingKey,
  type = "text",
  placeholder,
  initialDisplay,
  isSecret,
}: {
  label: string;
  description: string;
  settingKey: string;
  type?: "text" | "password";
  placeholder?: string;
  initialDisplay: string;
  isSecret: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [display, setDisplay] = useState(initialDisplay);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplay(initialDisplay);
  }, [initialDisplay]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/app", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: settingKey, value }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      setError(body.error ?? "Save failed");
      return;
    }
    setDisplay(isSecret && value ? `${"•".repeat(Math.max(8, value.length - 4))}${value.slice(-4)}` : value);
    setValue("");
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function clear() {
    await fetch("/api/settings/app", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: settingKey, value: null }),
    });
    setDisplay("");
    setValue("");
    setEditing(false);
  }

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
      </div>
      {!editing ? (
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
            {display || (
              <span className="text-zinc-400 dark:text-zinc-500 italic font-sans">Not set</span>
            )}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 underline"
          >
            {display ? "Edit" : "Set"}
          </button>
          {display && (
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
            type={type}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
          <button
            onClick={save}
            disabled={!value.trim() || saving}
            className="text-xs px-3 py-1.5 rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(""); }}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function HealthBadge({ result, label }: { result: HealthResult; label: string }) {
  if (result.connected) {
    const detail = [result.device, result.model].filter(Boolean).join(" · ");
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
        {label} connected{detail ? ` — ${detail}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-2.5 py-1 text-xs text-red-700 dark:text-red-400">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
      {label} unreachable — {result.error}
    </span>
  );
}

export default function InfrastructureSettingsCard() {
  const { find } = useInfraSettings();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  async function testConnections() {
    setTesting(true);
    setTestError(null);
    setHealth(null);
    try {
      const res = await fetch("/api/settings/gpu-worker/health");
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setTestError(body.error ?? `HTTP ${res.status}`);
      } else {
        setHealth(await res.json() as HealthResponse);
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  const whisperxUrl   = find("WHISPERX_URL");
  const whisperxKey   = find("WHISPERX_API_KEY");
  const sidecarUrl    = find("SIDECAR_URL");
  const sidecarKey    = find("SIDECAR_API_KEY");
  const appUrl        = find("APP_URL");

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 space-y-6 dark:border-zinc-700 dark:bg-zinc-900">

      {/* ── GPU Worker ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">GPU Worker</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            WhisperX runs on your dedicated GPU machine over Tailscale. When configured, audio
            is routed here for transcription. Falls back to AssemblyAI when blank.
          </p>
        </div>

        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-4 space-y-4">
          <FieldRow
            label={whisperxUrl?.label ?? "GPU Worker URL"}
            description={whisperxUrl?.description ?? ""}
            settingKey="WHISPERX_URL"
            type="text"
            placeholder={whisperxUrl?.placeholder ?? "http://100.x.x.x:8002"}
            initialDisplay={whisperxUrl?.displayValue ?? ""}
            isSecret={false}
          />
          <FieldRow
            label={whisperxKey?.label ?? "GPU Worker API Key"}
            description={whisperxKey?.description ?? ""}
            settingKey="WHISPERX_API_KEY"
            type="password"
            placeholder={whisperxKey?.placeholder ?? "your-random-secret"}
            initialDisplay={whisperxKey?.displayValue ?? ""}
            isSecret={true}
          />
        </div>
      </div>

      {/* ── Sidecar ────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Python Sidecar</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            FastAPI sidecar at :8001 handles spec parsing, drawing analysis, and AI extractions.
            Defaults to http://127.0.0.1:8001 in dev.
          </p>
        </div>

        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-4 space-y-4">
          <FieldRow
            label={sidecarUrl?.label ?? "Python Sidecar URL"}
            description={sidecarUrl?.description ?? ""}
            settingKey="SIDECAR_URL"
            type="text"
            placeholder={sidecarUrl?.placeholder ?? "http://127.0.0.1:8001"}
            initialDisplay={sidecarUrl?.displayValue ?? ""}
            isSecret={false}
          />
          <FieldRow
            label={sidecarKey?.label ?? "Sidecar API Key"}
            description={sidecarKey?.description ?? ""}
            settingKey="SIDECAR_API_KEY"
            type="password"
            placeholder={sidecarKey?.placeholder ?? "your-random-secret"}
            initialDisplay={sidecarKey?.displayValue ?? ""}
            isSecret={true}
          />
        </div>
      </div>

      {/* ── Test Connection ────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <button
          onClick={testConnections}
          disabled={testing}
          className="text-xs px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
        >
          {testing ? "Testing…" : "Test Connections"}
        </button>
        {testError && (
          <p className="text-xs text-red-500">{testError}</p>
        )}
        {health && (
          <div className="flex flex-wrap gap-2">
            <HealthBadge result={health.gpu} label="GPU worker" />
            <HealthBadge result={health.sidecar} label="Sidecar" />
          </div>
        )}
      </div>

      {/* ── App URL ────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">App URL</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Used for Procore webhooks and email callbacks.
          </p>
        </div>

        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-4">
          <FieldRow
            label={appUrl?.label ?? "App Public URL"}
            description={appUrl?.description ?? ""}
            settingKey="APP_URL"
            type="text"
            placeholder={appUrl?.placeholder ?? "https://groundworx.neuroglitch.ai"}
            initialDisplay={appUrl?.displayValue ?? ""}
            isSecret={false}
          />
        </div>
      </div>

    </section>
  );
}
