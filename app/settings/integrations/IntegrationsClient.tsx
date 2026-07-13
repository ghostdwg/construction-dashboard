"use client";

import { useCallback, useEffect, useState } from "react";

type SeedService = {
  id: string;
  name: string;
  fields: string[];
  description: string;
};

type FieldRecord = {
  field: string;
  masked: string;
  updatedAt: string;
};

type IntegrationStatus = {
  service: string;
  fields: FieldRecord[];
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
};

const inputCls =
  "rounded px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-[rgba(45,123,255,0.4)]";
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "var(--text)" };

function fmtDateTime(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

export default function IntegrationsClient({
  seed,
  initialState,
}: {
  seed: SeedService[];
  initialState: IntegrationStatus[];
}) {
  const [state, setState] = useState<IntegrationStatus[]>(initialState);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/credentials", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setState(data.integrations as IntegrationStatus[]);
  }, []);

  // Build a merged view: every seed service, with any stored field state from `state`
  const merged = seed.map((s) => {
    const stored = state.find((x) => x.service === s.id);
    return {
      ...s,
      fields: s.fields.map((f) => {
        const found = stored?.fields.find((x) => x.field === f);
        return {
          field: f,
          masked: found?.masked ?? "(not set)",
          updatedAt: found?.updatedAt ?? null,
          configured: !!found,
        };
      }),
      lastTestedAt: stored?.lastTestedAt ?? null,
      lastTestStatus: stored?.lastTestStatus ?? null,
      lastTestError: stored?.lastTestError ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      {merged.map((svc) => (
        <ServiceCard key={svc.id} svc={svc} onChanged={refresh} />
      ))}
    </div>
  );
}

function ServiceCard({
  svc, onChanged,
}: {
  svc: {
    id: string; name: string; description: string;
    fields: { field: string; masked: string; updatedAt: string | null; configured: boolean }[];
    lastTestedAt: string | null;
    lastTestStatus: string | null;
    lastTestError: string | null;
  };
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; error: string | null } | null>(null);

  async function save() {
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v?.length));
    if (Object.keys(filled).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/settings/credentials/${svc.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: filled }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Save failed: ${j.error ?? res.status}`);
      return;
    }
    setValues({});
    setEditing(false);
    onChanged();
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/settings/credentials/${svc.id}/test`, { method: "POST" });
      const j = await res.json();
      setTestResult({ status: j.status, error: j.error });
      onChanged();
    } finally {
      setTesting(false);
    }
  }

  async function clearAll() {
    if (!confirm(`Delete ALL stored credentials for ${svc.name}?`)) return;
    await fetch(`/api/settings/credentials/${svc.id}`, { method: "DELETE" });
    setValues({});
    onChanged();
  }

  const statusColor = svc.lastTestStatus === "success" ? "var(--signal)"
                    : svc.lastTestStatus === "failed"  ? "var(--red)"
                    : "var(--text-dim)";

  return (
    <div
      className="border border-[var(--line)] rounded-[var(--radius)] overflow-hidden"
      style={{ background: "linear-gradient(180deg,rgba(17,21,28,0.96),rgba(12,15,21,0.98))", boxShadow: "var(--shadow)" }}
    >
      <div className="px-4 py-3 border-b border-[var(--line)] flex items-start justify-between gap-3"
        style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-[700]" style={{ color: "var(--text)" }}>{svc.name}</p>
            <span className="font-mono text-[9px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded-full"
              style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
              {svc.id}
            </span>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
              background: statusColor, boxShadow: `0 0 8px ${statusColor}`,
            }} title={`Last test: ${svc.lastTestStatus ?? "untested"}`} />
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-dim)" }}>{svc.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={test} disabled={testing}
            className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--text-dim)", border: "1px solid var(--line)" }}>
            {testing ? "Testing…" : "Test"}
          </button>
          <button onClick={() => setEditing(!editing)}
            className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded transition-colors"
            style={{
              color: editing ? "var(--signal)" : "var(--text-dim)",
              border: `1px solid ${editing ? "rgba(45,123,255,0.3)" : "var(--line)"}`,
              background: editing ? "rgba(45,123,255,0.06)" : "transparent",
            }}>
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex flex-col divide-y divide-[var(--line)]">
          {svc.fields.map((f) => (
            <div key={f.field} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--text-dim)" }}>
                  {f.field}
                </p>
                {editing ? (
                  <input
                    type={/password|secret/i.test(f.field) ? "password" : "text"}
                    placeholder={f.configured ? "(leave blank to keep existing)" : `enter ${f.field}`}
                    value={values[f.field] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.field]: e.target.value })}
                    className={`${inputCls} w-full max-w-[420px] mt-1`} style={inputStyle}
                  />
                ) : (
                  <p className="text-[13px] font-mono mt-0.5"
                    style={{ color: f.configured ? "var(--text)" : "var(--text-dim)" }}>
                    {f.masked}
                  </p>
                )}
              </div>
              {!editing && f.updatedAt && (
                <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                  updated {new Date(f.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
        </div>

        {editing && (
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--line)] mt-2">
            <button onClick={clearAll}
              className="font-mono text-[10px] uppercase tracking-[0.07em] px-3 py-1.5 rounded"
              style={{ color: "var(--red)", border: "1px solid rgba(232,69,60,0.3)" }}>
              Clear All
            </button>
            <button onClick={save} disabled={saving}
              className="text-xs px-4 py-1.5 rounded font-[600] disabled:opacity-40"
              style={{ background: "var(--signal)", color: "#000" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        {(svc.lastTestedAt || testResult) && (
          <div className="mt-2 pt-2 border-t border-[var(--line)] flex items-center gap-2 text-[11px]"
            style={{ color: "var(--text-dim)" }}>
            <span>last tested {fmtDateTime(testResult ? new Date().toISOString() : svc.lastTestedAt)}</span>
            <span>·</span>
            <span style={{ color: statusColor }}>
              {testResult?.status ?? svc.lastTestStatus ?? "untested"}
            </span>
            {(testResult?.error || svc.lastTestError) && (
              <>
                <span>·</span>
                <span style={{ color: "var(--red)" }}>{testResult?.error ?? svc.lastTestError}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
