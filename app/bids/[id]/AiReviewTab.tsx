"use client";

import { useEffect, useState, useCallback } from "react";

// ----- Types -----

type Trade = { id: number; name: string };

type ScopeStats = {
  totalItems: number;
  tradeCount: number;
  restrictedItems: number;
};

type ExportResult = {
  json: string;
  restrictedStripped: number;
  filename: string;
};

type ParsedFinding = {
  tradeName: string;
  findingText: string;
  confidence: string | null;
};

type Finding = {
  id: number;
  bidId: number;
  tradeName: string | null;
  findingText: string;
  confidence: string | null;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
};

// ----- Parser (pure function, no side effects) -----

const CONFIDENCE_RE = /\b(high|medium|low)\s+confidence\b/i;
const PREFIX_RE = /^(Missing|Gap):\s*/i;

function parseFindings(text: string, defaultTrade: string): ParsedFinding[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (l.length < 10) return false;
      if (l.endsWith(":")) return false;
      // ALL CAPS check — has at least one letter and every letter is uppercase
      if (/[A-Z]/.test(l) && l === l.toUpperCase()) return false;
      return true;
    })
    .map((l) => {
      // Strip leading prefix
      const stripped = l.replace(PREFIX_RE, "").trim();
      // Extract confidence tag
      const confMatch = stripped.match(CONFIDENCE_RE);
      const confidence = confMatch ? confMatch[1].toLowerCase() : null;
      const findingText = confidence
        ? stripped.replace(confMatch![0], "").replace(/\s{2,}/g, " ").trim()
        : stripped;
      return { tradeName: defaultTrade, findingText, confidence };
    });
}

// ----- Constants -----

const EXPORT_CONFIRMATIONS = [
  "I confirm this export contains no cost or budget data",
  "I confirm this export has been reviewed for sensitive information",
  "I understand this file will be sent to an external AI service",
] as const;

// ----- Main component -----

export default function AiReviewTab({ bidId }: { bidId: number }) {
  // Section 1 — Export
  const [stats, setStats] = useState<ScopeStats | null>(null);
  const [checks, setChecks] = useState([false, false, false]);
  const [generating, setGenerating] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Section 2 — Import
  const [bidTrades, setBidTrades] = useState<Trade[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [selectedTradeNames, setSelectedTradeNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<ParsedFinding[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Section 3 — Findings review
  const [findings, setFindings] = useState<Finding[]>([]);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Sanitization warning
  const [pendingSanitizationCount, setPendingSanitizationCount] = useState(0);

  const loadFindings = useCallback(() => {
    fetch(`/api/bids/${bidId}/findings`)
      .then((r) => r.json())
      .then((data: Finding[]) => setFindings(Array.isArray(data) ? data : []));
  }, [bidId]);

  useEffect(() => {
    // Check for unapproved estimates
    fetch(`/api/bids/${bidId}/estimates`)
      .then((r) => (r.ok ? r.json() : []))
      .then((uploads: { parseStatus: string; approvedForAi: boolean }[]) => {
        if (!Array.isArray(uploads)) return;
        const pending = uploads.filter(
          (u) => u.parseStatus === "complete" && !u.approvedForAi
        ).length;
        setPendingSanitizationCount(pending);
      })
      .catch(() => {});
  }, [bidId]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/bids/${bidId}/scope`).then((r) => r.json()),
      fetch(`/api/bids/${bidId}`).then((r) => r.json()),
    ]).then(
      ([scopeData, bidData]: [
        {
          byTrade?: Record<string, { items: { restricted: boolean }[] }>;
          unassigned?: { restricted: boolean }[];
        },
        { bidTrades?: { trade: Trade }[] },
      ]) => {
        const byTrade = scopeData?.byTrade ?? {};
        const unassigned = scopeData?.unassigned ?? [];
        const allItems = [
          ...Object.values(byTrade).flatMap((g) => g.items),
          ...unassigned,
        ];
        setStats({
          totalItems: allItems.length,
          tradeCount: Object.keys(byTrade).length,
          restrictedItems: allItems.filter((i) => i.restricted).length,
        });
        setBidTrades(bidData.bidTrades?.map((bt) => bt.trade) ?? []);
      }
    );
    loadFindings();
  }, [bidId, loadFindings]);

  // ----- Section 1 handlers -----

  function toggleCheck(i: number) {
    setChecks((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  async function generate() {
    setGenerating(true);
    setExportError(null);
    setExportResult(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/export/ai-safe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setExportError((err as { error?: string }).error ?? "Export failed");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "ai_safe_export.json";
      const json = await res.text();
      const parsed = JSON.parse(json) as {
        exportMetadata?: { restrictedItemsStripped?: number };
      };
      setExportResult({
        json,
        restrictedStripped: parsed.exportMetadata?.restrictedItemsStripped ?? 0,
        filename,
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  async function copyJson() {
    if (!exportResult) return;
    await navigator.clipboard.writeText(exportResult.json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadJson() {
    if (!exportResult) return;
    const blob = new Blob([exportResult.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportResult.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ----- Section 2 handlers -----

  function toggleTrade(name: string) {
    setSelectedTradeNames((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  }

  function handleParse() {
    const defaultTrade = selectedTradeNames[0] ?? "";
    const parsed = parseFindings(pasteText, defaultTrade);
    setPreview(parsed);
    setImportError(null);
  }

  function updatePreviewTrade(idx: number, tradeName: string) {
    setPreview((prev) =>
      prev ? prev.map((f, i) => (i === idx ? { ...f, tradeName } : f)) : prev
    );
  }

  async function confirmImport() {
    if (!preview || preview.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: preview }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setImportError((err as { error?: string }).error ?? "Import failed");
        return;
      }
      setPasteText("");
      setSelectedTradeNames([]);
      setPreview(null);
      loadFindings();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setImporting(false);
    }
  }

  // ----- Section 3 handlers -----

  async function updateStatus(finding: Finding, status: string) {
    setUpdatingId(finding.id);
    try {
      const res = await fetch(`/api/findings/${finding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated: Finding = await res.json();
        setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      }
    } finally {
      setUpdatingId(null);
    }
  }

  async function generateQuestion(finding: Finding) {
    setUpdatingId(finding.id);
    try {
      const res = await fetch(`/api/findings/${finding.id}/generate-question`, {
        method: "POST",
      });
      if (res.ok) {
        // Mark finding as converted in local state
        setFindings((prev) =>
          prev.map((f) =>
            f.id === finding.id ? { ...f, status: "converted_to_question" } : f
          )
        );
      }
    } finally {
      setUpdatingId(null);
    }
  }

  const allChecked = checks.every(Boolean);
  const pending = findings.filter((f) => f.status === "pending_review");
  const approved = findings.filter((f) => f.status === "approved" || f.status === "converted_to_question");
  const dismissed = findings.filter((f) => f.status === "dismissed");

  return (
    <div className="flex flex-col gap-10">
      {/* ── Sanitization warning ── */}
      {pendingSanitizationCount > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          <span className="font-semibold">{pendingSanitizationCount} estimate{pendingSanitizationCount !== 1 ? "s" : ""} pending sanitization review.</span>{" "}
          Go to the Leveling tab to review flagged lines and approve estimates before AI export.
          Unapproved estimates will not be included in the export.
        </div>
      )}

      {/* ── Section 1 — Export ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-800">AI Safe Export</h2>

        {stats && (
          <div className="flex gap-6 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm">
            <span className="text-zinc-700">
              <span className="font-semibold">{stats.totalItems}</span>{" "}
              <span className="text-zinc-500">scope items</span>
            </span>
            <span className="text-zinc-700">
              <span className="font-semibold">{stats.tradeCount}</span>{" "}
              <span className="text-zinc-500">trades</span>
            </span>
            {stats.restrictedItems > 0 ? (
              <span className="text-amber-700">
                <span className="font-semibold">{stats.restrictedItems}</span>{" "}
                <span className="text-amber-600">
                  restricted item{stats.restrictedItems !== 1 ? "s" : ""} will be stripped
                </span>
              </span>
            ) : (
              <span className="text-zinc-400">no restricted items</span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 bg-white">
          {EXPORT_CONFIRMATIONS.map((label, i) => (
            <label key={i} className="flex items-start gap-3 text-sm text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={() => toggleCheck(i)}
                className="mt-0.5 rounded"
              />
              {label}
            </label>
          ))}
        </div>

        <div>
          <button
            onClick={generate}
            disabled={!allChecked || generating}
            className="rounded bg-black px-5 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? "Generating…" : "Generate AI Export"}
          </button>
        </div>

        {exportError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {exportError}
          </p>
        )}

        {exportResult && (
          <div className="flex flex-col gap-3">
            {exportResult.restrictedStripped > 0 && (
              <p className="text-sm text-amber-700">
                <span className="font-semibold">{exportResult.restrictedStripped}</span>{" "}
                restricted item{exportResult.restrictedStripped !== 1 ? "s were" : " was"} stripped
                from this export.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={copyJson}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
              >
                {copied ? "Copied!" : "Copy JSON"}
              </button>
              <button
                onClick={downloadJson}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
              >
                Download JSON
              </button>
            </div>
            <pre className="overflow-auto max-h-96 rounded-md border border-zinc-200 bg-zinc-950 text-zinc-100 text-xs p-4 leading-relaxed">
              {exportResult.json}
            </pre>
          </div>
        )}
      </section>

      {/* ── Section 2 — Import Findings ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-800">Import AI Findings</h2>

        {preview === null ? (
          /* ─ Input state ─ */
          <div className="flex flex-col gap-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste AI findings here — one finding per line"
              rows={8}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-y font-mono"
            />

            {bidTrades.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1.5">
                  Associate with trades (optional — sets default trade on parsed findings)
                </p>
                <div className="flex flex-wrap gap-2">
                  {bidTrades.map((t) => {
                    const on = selectedTradeNames.includes(t.name);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTrade(t.name)}
                        className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                          on
                            ? "bg-zinc-900 text-white border-zinc-900"
                            : "bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500"
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <button
                onClick={handleParse}
                disabled={!pasteText.trim()}
                className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Parse and Import
              </button>
            </div>
          </div>
        ) : (
          /* ─ Preview state ─ */
          <div className="flex flex-col gap-3">
            {preview.length === 0 ? (
              <p className="text-sm text-zinc-500 italic">
                No findings parsed — check that lines are at least 10 characters and not all-caps headers.
              </p>
            ) : (
              <>
                <p className="text-sm text-zinc-600">
                  <span className="font-semibold">{preview.length}</span> finding
                  {preview.length !== 1 ? "s" : ""} parsed. Review and confirm trade assignments before importing.
                </p>
                <div className="border border-zinc-200 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide w-44">
                          Trade
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                          Finding Text
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide w-28">
                          Confidence
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((f, i) => (
                        <tr key={i} className="border-b border-zinc-100 last:border-0">
                          <td className="px-4 py-2">
                            <select
                              value={f.tradeName}
                              onChange={(e) => updatePreviewTrade(i, e.target.value)}
                              className="w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
                            >
                              <option value="">Unassigned</option>
                              {bidTrades.map((t) => (
                                <option key={t.id} value={t.name}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2 text-zinc-700 leading-snug">{f.findingText}</td>
                          <td className="px-4 py-2">
                            {f.confidence ? (
                              <span className="rounded-full px-2 py-0.5 text-xs bg-zinc-100 text-zinc-600 capitalize">
                                {f.confidence}
                              </span>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {importError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {importError}
              </p>
            )}

            <div className="flex gap-2">
              {preview.length > 0 && (
                <button
                  onClick={confirmImport}
                  disabled={importing}
                  className="rounded bg-black px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {importing ? "Importing…" : "Confirm Import"}
                </button>
              )}
              <button
                onClick={() => {
                  setPreview(null);
                  setImportError(null);
                }}
                className="rounded border border-zinc-300 px-4 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Section 3 — Findings Review ── */}
      {findings.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-zinc-800">
            Findings Review
            <span className="ml-2 font-normal text-zinc-400">({findings.length})</span>
          </h2>

          <div className="grid grid-cols-3 gap-4">
            <FindingColumn
              title="Pending Review"
              findings={pending}
              updatingId={updatingId}
              onApprove={(f) => updateStatus(f, "approved")}
              onDismiss={(f) => updateStatus(f, "dismissed")}
            />
            <FindingColumn
              title="Approved"
              findings={approved}
              updatingId={updatingId}
              onGenerateQuestion={generateQuestion}
            />
            <FindingColumn
              title="Dismissed"
              findings={dismissed}
              updatingId={updatingId}
              onRestore={(f) => updateStatus(f, "pending_review")}
            />
          </div>
        </section>
      )}
    </div>
  );
}

// ----- Internal components -----

function FindingColumn({
  title,
  findings,
  updatingId,
  onApprove,
  onDismiss,
  onRestore,
  onGenerateQuestion,
}: {
  title: string;
  findings: Finding[];
  updatingId: number | null;
  onApprove?: (f: Finding) => void;
  onDismiss?: (f: Finding) => void;
  onRestore?: (f: Finding) => void;
  onGenerateQuestion?: (f: Finding) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
        {title}
        <span className="ml-1.5 font-normal text-zinc-400">({findings.length})</span>
      </h3>
      <div className="flex flex-col gap-2">
        {findings.length === 0 && (
          <p className="text-xs text-zinc-400 italic">None.</p>
        )}
        {findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            updating={updatingId === f.id}
            onApprove={onApprove}
            onDismiss={onDismiss}
            onRestore={onRestore}
            onGenerateQuestion={onGenerateQuestion}
          />
        ))}
      </div>
    </div>
  );
}

function FindingCard({
  finding,
  updating,
  onApprove,
  onDismiss,
  onRestore,
  onGenerateQuestion,
}: {
  finding: Finding;
  updating: boolean;
  onApprove?: (f: Finding) => void;
  onDismiss?: (f: Finding) => void;
  onRestore?: (f: Finding) => void;
  onGenerateQuestion?: (f: Finding) => void;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 flex flex-col gap-2">
      {finding.tradeName && (
        <span className="self-start rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
          {finding.tradeName}
        </span>
      )}
      <p className="text-xs text-zinc-700 leading-snug">{finding.findingText}</p>
      {finding.confidence && (
        <p className="text-xs text-zinc-400 capitalize">Confidence: {finding.confidence}</p>
      )}
      <div className="flex flex-wrap gap-1.5 mt-1">
        {onApprove && (
          <button
            onClick={() => onApprove(finding)}
            disabled={updating}
            className="rounded px-2 py-0.5 text-xs bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
        )}
        {onDismiss && (
          <button
            onClick={() => onDismiss(finding)}
            disabled={updating}
            className="rounded px-2 py-0.5 text-xs bg-zinc-200 text-zinc-700 hover:bg-zinc-300 disabled:opacity-50"
          >
            Dismiss
          </button>
        )}
        {onRestore && (
          <button
            onClick={() => onRestore(finding)}
            disabled={updating}
            className="rounded px-2 py-0.5 text-xs border border-zinc-300 text-zinc-600 hover:border-zinc-400 disabled:opacity-50"
          >
            Restore
          </button>
        )}
        {finding.status === "approved" && onGenerateQuestion && (
          <button
            onClick={() => onGenerateQuestion(finding)}
            disabled={updating}
            className="rounded px-2 py-0.5 text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Generate Question
          </button>
        )}
      </div>
    </div>
  );
}
