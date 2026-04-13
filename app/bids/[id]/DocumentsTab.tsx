"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Trade = { id: number; name: string };

type AiAnalysis = {
  description?: string;
  severity?: string;
  severity_reason?: string;
  submittals?: Array<{ type: string; description: string; engineer_review?: boolean }>;
  pain_points?: Array<{ issue: string; severity: string; cost_impact: string }>;
  gaps?: Array<{ issue: string; recommendation: string }>;
  flags?: string[];
  products?: Array<{ manufacturer: string; product: string; basis_of_design?: boolean }>;
  warranty?: Array<{ duration: string; type: string; scope: string }>;
  _model?: string;
};

type SectionRow = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  tradeId: number | null;
  trade: Trade | null;
  matchedTradeId: number | null;
  matchedTrade: Trade | null;
  source: string | null;
  aiExtractions: AiAnalysis | null;
};

type SpecBookMeta = {
  id: number;
  fileName: string;
  status: "processing" | "ready" | "error";
  uploadedAt: string;
};

type SpecData = {
  specBook: SpecBookMeta;
  total: number;
  coveredCount: number;
  missingCount: number;
  unknownCount: number;
  covered: SectionRow[];
  missing: SectionRow[];
  unknown: SectionRow[];
  aiAnalysis?: {
    sectionsAnalyzed: number;
    severity: Record<string, number>;
  } | null;
};

type DrawingSheetRow = {
  id: number;
  sheetNumber: string;
  sheetTitle: string | null;
  discipline: string;
  tradeId: number | null;
  trade: Trade | null;
  matchedTradeId: number | null;
  matchedTrade: Trade | null;
};

type DrawingUploadMeta = {
  id: number;
  fileName: string;
  status: "processing" | "ready" | "error";
  uploadedAt: string;
};

type DrawingUploadEntry = DrawingUploadMeta & {
  discipline: string;
  sheetCount: number;
};

type DrawingData = {
  drawingUpload: DrawingUploadMeta | null;
  uploads?: DrawingUploadEntry[];
  total: number;
  coveredCount: number;
  missingCount: number;
  covered: DrawingSheetRow[];
  missing: DrawingSheetRow[];
};

type ScopeChange = {
  type: string;
  description: string;
  location: string;
  costImpact: string;
  scheduleImpact: string;
  actionRequired: string;
};

type Clarification = {
  description: string;
  location: string;
  actionRequired: string;
};

type NewRisk = {
  severity: string;
  description: string;
  sourceRef: string;
  recommendedAction: string;
};

type AddendumDelta = {
  addendumNumber: number;
  dateIssued: string | null;
  summary: string;
  changesIdentified: number;
  scopeChanges: ScopeChange[];
  clarifications: Clarification[];
  newRisks: NewRisk[];
  resolvedItems: string[];
  netCostDirection: "INCREASE" | "DECREASE" | "NEUTRAL";
  netScheduleDirection: "INCREASE" | "DECREASE" | "NEUTRAL";
  actionsRequired: string[];
};

type AddendumRow = {
  id: number;
  addendumNumber: number;
  addendumDate: string | null;
  fileName: string;
  uploadedAt: string;
  status: string;
  deltaJson: string | null;
  deltaGeneratedAt: string | null;
  summary: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const DISCIPLINE_LABELS: Record<string, string> = {
  A: "Architectural",
  S: "Structural",
  M: "Mechanical",
  P: "Plumbing",
  E: "Electrical",
  C: "Civil",
  FP: "Fire Protection",
};

type SplitDiscipline = {
  discipline: string;
  label: string;
  page_count: number;
  sheet_numbers: string[];
};

type SplitResult = {
  total_pages: number;
  disciplines: SplitDiscipline[];
  unidentified_pages: number[];
};

const DISCIPLINE_OPTIONS: { value: string; label: string }[] = [
  { value: "GENERAL", label: "General" },
  { value: "CIVIL", label: "Civil" },
  { value: "ARCH", label: "Architectural" },
  { value: "STRUCT", label: "Structural" },
  { value: "MECH", label: "Mechanical" },
  { value: "ELEC", label: "Electrical" },
  { value: "PLUMB", label: "Plumbing" },
  { value: "INTERIOR", label: "Interior" },
  { value: "FP", label: "Fire Protection" },
];

async function safeJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

// ── Upload zone ───────────────────────────────────────────────────────────────

function UploadZone({
  label,
  currentFileName,
  uploading,
  error,
  onFile,
}: {
  label: string;
  currentFileName?: string;
  uploading: boolean;
  error: string | null;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex-1">
      <h2 className="text-sm font-semibold text-zinc-700 mb-2 dark:text-zinc-200">{label}</h2>
      <div
        className="rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center hover:border-zinc-400 transition-colors cursor-pointer dark:border-zinc-600 dark:bg-zinc-800"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        <input
          ref={ref}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Uploading and parsing…</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 font-medium dark:text-zinc-300">
              {currentFileName ? "Replace" : "Upload"} PDF
            </p>
            <p className="text-xs text-zinc-400 mt-1 dark:text-zinc-500">Drop here or click to browse</p>
            {currentFileName && (
              <p className="text-xs text-zinc-400 mt-1 dark:text-zinc-500">Current: {currentFileName}</p>
            )}
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}

// ── Coverage sections ─────────────────────────────────────────────────────────

function CoveredSection({ rows }: { rows: (SectionRow | DrawingSheetRow)[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-green-200 bg-green-50 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-green-800 hover:bg-green-100 transition-colors dark:text-green-300"
      >
        <span>Covered — {rows.length} trade{rows.length !== 1 ? "s" : ""}</span>
        <span className="text-green-600 text-xs">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div className="border-t border-green-200">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 px-4 py-2 border-b border-green-100 last:border-0 text-sm text-green-900"
            >
              {"csiNumber" in row ? (
                <>
                  <span className="font-mono text-xs text-green-700 w-20 shrink-0">
                    {row.csiNumber}
                  </span>
                  <span>{row.csiTitle}</span>
                  <span className="ml-auto text-xs text-green-600">{row.trade?.name}</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-xs text-green-700 w-16 shrink-0">
                    {DISCIPLINE_LABELS[row.discipline] ?? row.discipline}
                  </span>
                  <span>{row.trade?.name}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MissingSection({
  rows,
  addingIds,
  onAddToBid,
}: {
  rows: (SectionRow | DrawingSheetRow)[];
  addingIds: Set<number>;
  onAddToBid: (tradeId: number, tradeName: string) => void;
}) {
  if (rows.length === 0) return null;

  // Deduplicate by matchedTradeId across spec + drawings rows
  const seen = new Set<number>();
  const deduped = rows.filter((r) => {
    if (!r.matchedTradeId) return false;
    if (seen.has(r.matchedTradeId)) return false;
    seen.add(r.matchedTradeId);
    return true;
  });

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-200">
        <span className="text-sm font-medium text-amber-900">
          Missing from bid — {deduped.length} trade{deduped.length !== 1 ? "s" : ""}
        </span>
        <p className="text-xs text-amber-700 mt-0.5">
          Found in project documents but not assigned to this bid.
        </p>
      </div>
      {deduped.map((row) => {
        const tradeId = row.matchedTradeId!;
        const tradeName = row.matchedTrade?.name ?? "";
        const adding = addingIds.has(tradeId);
        const source = "csiNumber" in row
          ? `Spec §${row.csiNumber}`
          : `${DISCIPLINE_LABELS[row.discipline] ?? row.discipline} drawings`;
        return (
          <div
            key={tradeId}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-100 last:border-0"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900">{tradeName}</p>
              <p className="text-xs text-amber-600">{source}</p>
            </div>
            <button
              disabled={adding}
              onClick={() => onAddToBid(tradeId, tradeName)}
              className="shrink-0 rounded border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50 transition-colors dark:bg-amber-900/40 dark:text-amber-300"
            >
              {adding ? "Adding…" : "Add to Bid"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── AI Spec Intelligence Results ─────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-800 dark:text-red-300", border: "border-red-200 dark:border-red-800" },
  HIGH: { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-800 dark:text-orange-300", border: "border-orange-200 dark:border-orange-800" },
  MODERATE: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-800 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800" },
  LOW: { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-600 dark:text-zinc-400", border: "border-zinc-200 dark:border-zinc-700" },
  INFO: { bg: "bg-blue-50 dark:bg-blue-900/20", text: "text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-900" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY_STYLES[severity.toUpperCase()] ?? SEVERITY_STYLES.INFO;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${s.bg} ${s.text}`}>
      {severity}
    </span>
  );
}

function AiSpecResults({
  sections,
  severity,
}: {
  sections: SectionRow[];
  severity: Record<string, number>;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null);

  // Sort: CRITICAL first, then HIGH, MODERATE, LOW, INFO
  const severityOrder = ["CRITICAL", "HIGH", "MODERATE", "LOW", "INFO"];
  const sorted = [...sections].sort((a, b) => {
    const aIdx = severityOrder.indexOf((a.aiExtractions?.severity || "INFO").toUpperCase());
    const bIdx = severityOrder.indexOf((b.aiExtractions?.severity || "INFO").toUpperCase());
    return aIdx - bIdx;
  });

  const filtered = filterSeverity
    ? sorted.filter((s) => (s.aiExtractions?.severity || "").toUpperCase() === filterSeverity)
    : sorted;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header + severity filter */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          AI Spec Intelligence — {sections.length} sections analyzed
        </h3>
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilterSeverity(null)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              !filterSeverity
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            All ({sections.length})
          </button>
          {severityOrder.map((sev) => {
            const count = severity[sev] || 0;
            if (count === 0) return null;
            const s = SEVERITY_STYLES[sev];
            return (
              <button
                key={sev}
                onClick={() => setFilterSeverity(filterSeverity === sev ? null : sev)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  filterSeverity === sev
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : `${s.bg} ${s.text}`
                }`}
              >
                {count} {sev}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section list */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {filtered.map((sec) => {
          const ai = sec.aiExtractions;
          const isExpanded = expandedId === sec.id;
          const sev = (ai?.severity || "INFO").toUpperCase();

          return (
            <div key={sec.id}>
              {/* Row header */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : sec.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 w-16 shrink-0">
                  {sec.csiNumber}
                </span>
                <SeverityBadge severity={sev} />
                <span className="text-sm text-zinc-800 dark:text-zinc-200 flex-1 truncate">
                  {sec.csiTitle}
                </span>
                <span className="flex gap-2 text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
                  {(ai?.pain_points?.length ?? 0) > 0 && (
                    <span>{ai!.pain_points!.length} pain pts</span>
                  )}
                  {(ai?.gaps?.length ?? 0) > 0 && (
                    <span>{ai!.gaps!.length} gaps</span>
                  )}
                  {(ai?.submittals?.length ?? 0) > 0 && (
                    <span>{ai!.submittals!.length} submittals</span>
                  )}
                </span>
                <span className="text-zinc-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
              </button>

              {/* Expanded detail */}
              {isExpanded && ai && (
                <div className="px-4 pb-4 pt-1 space-y-3 bg-zinc-50/50 dark:bg-zinc-800/30">
                  {/* Description */}
                  {ai.description && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{ai.description}</p>
                  )}

                  {/* Flags */}
                  {ai.flags && ai.flags.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase mb-1">Flags</h4>
                      <ul className="space-y-1">
                        {ai.flags.map((f, i) => (
                          <li key={i} className="text-xs text-red-700 dark:text-red-400 flex gap-1.5">
                            <span className="shrink-0">!</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Pain Points */}
                  {ai.pain_points && ai.pain_points.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase mb-1">Pain Points</h4>
                      <div className="space-y-1.5">
                        {ai.pain_points.map((p, i) => (
                          <div key={i} className="text-xs">
                            <div className="flex gap-2 items-start">
                              <SeverityBadge severity={p.severity} />
                              <span className="text-zinc-800 dark:text-zinc-200">{p.issue}</span>
                            </div>
                            {p.cost_impact && (
                              <p className="text-zinc-500 dark:text-zinc-400 ml-12 mt-0.5">{p.cost_impact}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Gaps */}
                  {ai.gaps && ai.gaps.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase mb-1">Gaps</h4>
                      <div className="space-y-1.5">
                        {ai.gaps.map((g, i) => (
                          <div key={i} className="text-xs">
                            <p className="text-zinc-800 dark:text-zinc-200">{g.issue}</p>
                            <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">Recommendation: {g.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Submittals */}
                  {ai.submittals && ai.submittals.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase mb-1">Submittals ({ai.submittals.length})</h4>
                      <div className="space-y-1">
                        {ai.submittals.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="rounded bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-mono text-blue-700 dark:text-blue-400 shrink-0">
                              {s.type}
                            </span>
                            <span className="text-zinc-700 dark:text-zinc-300">{s.description}</span>
                            {s.engineer_review && (
                              <span className="text-[10px] text-violet-600 dark:text-violet-400 shrink-0">ENG REVIEW</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Products */}
                  {ai.products && ai.products.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase mb-1">Products</h4>
                      <div className="space-y-1">
                        {ai.products.map((p, i) => (
                          <div key={i} className="text-xs text-zinc-700 dark:text-zinc-300">
                            <span className="font-medium">{p.manufacturer}</span> — {p.product}
                            {p.basis_of_design && (
                              <span className="ml-1 text-[10px] text-green-600 dark:text-green-400">(BOD)</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warranty */}
                  {ai.warranty && ai.warranty.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase mb-1">Warranty</h4>
                      <div className="space-y-1">
                        {ai.warranty.map((w, i) => (
                          <div key={i} className="text-xs text-zinc-700 dark:text-zinc-300">
                            <span className="font-medium">{w.duration}</span> — {w.type}: {w.scope}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ai._model && (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-1">
                      Analyzed by {ai._model}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UnknownSection({
  rows,
  allTrades,
  assigningId,
  onAssign,
}: {
  rows: SectionRow[];
  allTrades: Trade[];
  assigningId: number | null;
  onAssign: (sectionId: number, tradeId: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
      <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Unknown — {rows.length} section{rows.length !== 1 ? "s" : ""}
        </span>
        <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
          No trade in the dictionary matches these CSI sections. Assign manually.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide border-b border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
          <tr>
            <th className="px-4 py-2.5 w-24">CSI</th>
            <th className="px-4 py-2.5">Section</th>
            <th className="px-4 py-2.5 w-52">Assign Trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
              <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.csiNumber}</td>
              <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-200">{row.csiTitle}</td>
              <td className="px-4 py-2.5">
                <select
                  defaultValue=""
                  disabled={assigningId === row.id}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) onAssign(row.id, val);
                    e.target.value = "";
                  }}
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900"
                >
                  <option value="">— Assign trade</option>
                  {allTrades.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DocumentsTab({ bidId }: { bidId: number }) {
  const [specData, setSpecData] = useState<SpecData | null>(null);
  const [drawingData, setDrawingData] = useState<DrawingData | null>(null);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [specUploading, setSpecUploading] = useState(false);
  const [specUploadError, setSpecUploadError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeSectionsProcessed, setAnalyzeSectionsProcessed] = useState(0);
  const [analyzeTotalSections, setAnalyzeTotalSections] = useState(0);
  const [analyzeCurrentSection, setAnalyzeCurrentSection] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<{
    sectionsAnalyzed: number;
    summary: Record<string, number>;
    totalCost: number;
  } | null>(null);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUploadError, setDrawingUploadError] = useState<string | null>(null);
  const [drawingMode, setDrawingMode] = useState<"fullset" | "discipline">("fullset");
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [disciplineUploading, setDisciplineUploading] = useState<string | null>(null);

  const [specRematching, setSpecRematching] = useState(false);
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set());
  const [assigningId, setAssigningId] = useState<number | null>(null);

  // Addendums
  const [addendums, setAddendums] = useState<AddendumRow[]>([]);
  const [addendumNumber, setAddendumNumber] = useState("");
  const [addendumDate, setAddendumDate] = useState("");
  const [addendumUploading, setAddendumUploading] = useState(false);
  const [addendumUploadError, setAddendumUploadError] = useState<string | null>(null);
  const [deletingAddendumId, setDeletingAddendumId] = useState<number | null>(null);
  const [, setBriefIsStale] = useState(false);
  const [briefExists, setBriefExists] = useState(false);
  const [processingDeltaId, setProcessingDeltaId] = useState<number | null>(null);
  const [deltaError, setDeltaError] = useState<{ id: number; message: string } | null>(null);
  const [expandedDeltaId, setExpandedDeltaId] = useState<number | null>(null);
  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({});
  const addendumFileRef = useRef<HTMLInputElement>(null);

  // ── Load on mount ──────────────────────────────────────────────────────────

  const loadAddendums = useCallback(async () => {
    const res = await fetch(`/api/bids/${bidId}/addendums`);
    if (res.ok) setAddendums((await res.json()) as AddendumRow[]);
  }, [bidId]);

  async function loadAll() {
    try {
      const [specRes, drawingRes, tradesRes] = await Promise.all([
        fetch(`/api/bids/${bidId}/specbook/gaps`),
        fetch(`/api/bids/${bidId}/drawings/gaps`),
        fetch(`/api/trades`),
      ]);
      setSpecData(await safeJson<SpecData>(specRes));
      setDrawingData(await safeJson<DrawingData>(drawingRes));
      setAllTrades((await safeJson<Trade[]>(tradesRes)) ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    loadAddendums();
    // Check brief state
    fetch(`/api/bids/${bidId}/intelligence`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { brief: { isStale?: boolean; status?: string } | null } | null) => {
        const b = data?.brief;
        if (b?.isStale) setBriefIsStale(true);
        if (b?.status === "ready") setBriefExists(true);
      })
      .catch(() => {});
  }, [bidId, loadAddendums]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Spec book upload ───────────────────────────────────────────────────────

  async function handleSpecUpload(file: File) {
    setSpecUploading(true);
    setSpecUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/bids/${bidId}/specbook/upload`, { method: "POST", body: form });
      const result = await res.json();
      if (!res.ok) {
        setSpecUploadError(result.error ?? "Upload failed");
      } else {
        setSpecData(await safeJson<SpecData>(await fetch(`/api/bids/${bidId}/specbook/gaps`)));
      }
    } catch (e) {
      setSpecUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSpecUploading(false);
    }
  }

  // ── AI Analysis (separate from upload) ─────────────────────────────────────

  async function runAiAnalysis() {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeResult(null);
    setAnalyzeProgress(0);
    setAnalyzeSectionsProcessed(0);
    setAnalyzeTotalSections(0);
    setAnalyzeCurrentSection(null);

    try {
      // Step 1: Submit the job
      const submitRes = await fetch(`/api/bids/${bidId}/specbook/analyze`, { method: "POST" });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        setAnalyzeError(submitData.error ?? "Failed to start analysis");
        setAnalyzing(false);
        return;
      }

      const { jobId } = submitData as { jobId: string };

      // Step 2: Poll for progress
      const poll = async (): Promise<boolean> => {
        const res = await fetch(`/api/bids/${bidId}/specbook/analyze?jobId=${jobId}`);
        const data = await res.json();

        if (data.status === "complete") {
          setAnalyzeResult({
            sectionsAnalyzed: data.sectionsAnalyzed,
            summary: data.summary,
            totalCost: data.totalCost,
          });
          setAnalyzeProgress(100);
          setSpecData(await safeJson<SpecData>(await fetch(`/api/bids/${bidId}/specbook/gaps`)));
          return true;
        }

        if (data.status === "error") {
          setAnalyzeError(data.error ?? "Analysis failed");
          return true;
        }

        // Update progress
        setAnalyzeProgress(data.progress ?? 0);
        setAnalyzeSectionsProcessed(data.sectionsProcessed ?? 0);
        setAnalyzeTotalSections(data.totalSections ?? 0);
        setAnalyzeCurrentSection(data.currentSection ?? null);
        return false;
      };

      // Poll every 3 seconds
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          done = await poll();
        } catch {
          // Network hiccup — keep trying
        }
      }
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Drawing upload — fullset (auto-split via sidecar) ──────────────────────

  async function handleFullsetUpload(file: File) {
    setSplitting(true);
    setSplitResult(null);
    setDrawingUploadError(null);
    try {
      // Try sidecar split first
      const sidecarUrl = "/api/bids/" + bidId + "/drawings/split";
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(sidecarUrl, { method: "POST", body: form });
      if (res.ok) {
        const result = (await res.json()) as SplitResult;
        if (result.disciplines.length > 0) {
          setSplitResult(result);
          setSplitting(false);
          return;
        }
      }
      // Fallback: upload as fullset directly
      await uploadDrawing(file, "FULLSET");
    } catch (e) {
      setDrawingUploadError(e instanceof Error ? e.message : "Split analysis failed");
    } finally {
      setSplitting(false);
    }
  }

  async function confirmSplit() {
    // Upload as fullset — the split result is informational
    // (future: actually split the PDF and upload per-discipline)
    setDrawingUploading(true);
    setDrawingUploadError(null);
    setSplitResult(null);
    try {
      // For now, upload the original file as FULLSET
      // The split result shows the user what was detected
      setDrawingData(await safeJson<DrawingData>(await fetch(`/api/bids/${bidId}/drawings/gaps`)));
    } finally {
      setDrawingUploading(false);
    }
  }

  // ── Drawing upload — per-discipline ───────────────────────────────────────

  async function uploadDrawing(file: File, discipline: string) {
    setDrawingUploading(true);
    setDisciplineUploading(discipline);
    setDrawingUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/bids/${bidId}/drawings/upload?discipline=${discipline}`,
        { method: "POST", body: form }
      );
      const result = await res.json();
      if (!res.ok) {
        setDrawingUploadError(result.error ?? "Upload failed");
      } else {
        setDrawingData(await safeJson<DrawingData>(await fetch(`/api/bids/${bidId}/drawings/gaps`)));
      }
    } catch (e) {
      setDrawingUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setDrawingUploading(false);
      setDisciplineUploading(null);
    }
  }

  // ── Rematch spec ───────────────────────────────────────────────────────────

  async function rematchSpec() {
    setSpecRematching(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/specbook/rematch`, { method: "POST" });
      if (res.ok) {
        setSpecData(await safeJson<SpecData>(await fetch(`/api/bids/${bidId}/specbook/gaps`)));
      }
    } finally {
      setSpecRematching(false);
    }
  }

  // ── Add to bid ─────────────────────────────────────────────────────────────

  async function addToBid(tradeId: number) {
    setAddingIds((prev) => new Set(prev).add(tradeId));
    try {
      const res = await fetch(`/api/bids/${bidId}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId }),
      });
      if (!res.ok) return;

      // Rematch both sources, then reload gaps
      await Promise.all([
        specData ? fetch(`/api/bids/${bidId}/specbook/rematch`, { method: "POST" }) : null,
        drawingData ? fetch(`/api/bids/${bidId}/drawings/rematch`, { method: "POST" }) : null,
      ]);

      const [newSpec, newDrawing] = await Promise.all([
        specData ? safeJson<SpecData>(await fetch(`/api/bids/${bidId}/specbook/gaps`)) : null,
        drawingData ? safeJson<DrawingData>(await fetch(`/api/bids/${bidId}/drawings/gaps`)) : null,
      ]);
      if (newSpec !== undefined) setSpecData(newSpec);
      if (newDrawing !== undefined) setDrawingData(newDrawing);
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(tradeId);
        return next;
      });
    }
  }

  // ── Addendum upload ────────────────────────────────────────────────────────

  async function handleAddendumUpload(file: File) {
    const num = parseInt(addendumNumber, 10);
    if (isNaN(num) || num < 1) {
      setAddendumUploadError("Enter a valid addendum number first.");
      return;
    }
    setAddendumUploading(true);
    setAddendumUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("addendumNumber", String(num));
      if (addendumDate) form.append("addendumDate", addendumDate);
      const res = await fetch(`/api/bids/${bidId}/addendums/upload`, { method: "POST", body: form });
      const result = await res.json();
      if (!res.ok) {
        setAddendumUploadError(result.error ?? "Upload failed");
      } else {
        setAddendumNumber("");
        setAddendumDate("");
        setBriefIsStale(true);
        await loadAddendums();
      }
    } catch (e) {
      setAddendumUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setAddendumUploading(false);
    }
  }

  async function deleteAddendum(id: number) {
    setDeletingAddendumId(id);
    try {
      const res = await fetch(`/api/bids/${bidId}/addendums/${id}`, { method: "DELETE" });
      if (res.ok) {
        setBriefIsStale(true);
        await loadAddendums();
      }
    } finally {
      setDeletingAddendumId(null);
    }
  }

  // ── Process addendum delta ─────────────────────────────────────────────────

  async function processDelta(addendumId: number) {
    setProcessingDeltaId(addendumId);
    setDeltaError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}/addendums/${addendumId}/delta`, {
        method: "POST",
      });
      const result = await res.json() as { error?: string; delta?: AddendumDelta };
      if (!res.ok) {
        setDeltaError({ id: addendumId, message: result.error ?? "Delta processing failed" });
        return;
      }
      // Reload addendums to get updated deltaJson/summary
      await loadAddendums();
      setBriefIsStale(false);
      setExpandedDeltaId(addendumId);
    } catch (e) {
      setDeltaError({ id: addendumId, message: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setProcessingDeltaId(null);
    }
  }

  // ── Assign trade to unknown section ───────────────────────────────────────

  async function assignSection(sectionId: number, tradeId: number) {
    setAssigningId(sectionId);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/specbook/sections/${sectionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tradeId }),
        }
      );
      if (!res.ok) return;

      // Reload spec gaps (the section moved from unknown → covered, and a BidTrade may have been created)
      const newSpec = await safeJson<SpecData>(await fetch(`/api/bids/${bidId}/specbook/gaps`));
      setSpecData(newSpec);
    } finally {
      setAssigningId(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;
  if (fetchError) return <p className="text-sm text-red-500">Error: {fetchError}</p>;

  // Merge missing rows from both sources for the MissingSection component
  const allMissing: (SectionRow | DrawingSheetRow)[] = [
    ...(specData?.missing ?? []),
    ...(drawingData?.missing ?? []),
  ];

  const totalCovered =
    (specData?.coveredCount ?? 0) + (drawingData?.coveredCount ?? 0);
  const totalMissing = allMissing.length;
  const hasResults = specData?.specBook || drawingData?.drawingUpload;

  return (
    <div className="flex flex-col gap-6">

      {/* ── Spec Book Upload + AI Analysis ── */}
      <div className="flex gap-4">
        <div className="flex-1">
          <UploadZone
            label="Spec Book"
            currentFileName={specData?.specBook?.fileName}
            uploading={specUploading}
            error={specUploadError}
            onFile={handleSpecUpload}
          />
        </div>
      </div>

      {/* AI Analysis button — appears after spec book is uploaded */}
      {specData?.specBook?.status === "ready" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                AI Spec Analysis
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Reads every CSI section · flags pain points, gaps, submittals · ~$3–5
              </p>
            </div>
            <button
              onClick={runAiAnalysis}
              disabled={analyzing}
              className="rounded-md bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {analyzing ? "Analyzing…" : "Run AI Analysis"}
            </button>
          </div>

          {/* Progress bar */}
          {analyzing && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                <span>
                  {analyzeTotalSections > 0
                    ? `Analyzing section ${analyzeSectionsProcessed} of ${analyzeTotalSections}`
                    : "Identifying spec sections…"}
                  {analyzeCurrentSection && (
                    <span className="ml-1 font-mono text-violet-400">({analyzeCurrentSection})</span>
                  )}
                </span>
                <span>{Math.round(analyzeProgress)}%</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all duration-500"
                  style={{ width: `${Math.max(analyzeProgress, 2)}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                MEP + structural → Sonnet · all others → Haiku
              </p>
            </div>
          )}

          {/* Error */}
          {analyzeError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
              {analyzeError}
            </div>
          )}

          {/* Results summary */}
          {analyzeResult && (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Analysis complete — {analyzeResult.sectionsAnalyzed} sections reviewed
              </p>
              <div className="flex flex-wrap gap-3 mt-2">
                {analyzeResult.summary.critical > 0 && (
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                    {analyzeResult.summary.critical} Critical
                  </span>
                )}
                {analyzeResult.summary.high > 0 && (
                  <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                    {analyzeResult.summary.high} High
                  </span>
                )}
                {analyzeResult.summary.moderate > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    {analyzeResult.summary.moderate} Moderate
                  </span>
                )}
                {(analyzeResult.summary.low ?? 0) + (analyzeResult.summary.info ?? 0) > 0 && (
                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {(analyzeResult.summary.low ?? 0) + (analyzeResult.summary.info ?? 0)} Low/Info
                  </span>
                )}
              </div>
              <p className="text-[10px] text-green-600 dark:text-green-400 mt-2">
                Cost: ${analyzeResult.totalCost.toFixed(2)}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Drawing Uploads ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Drawing Sheets</h2>
          <div className="flex gap-1 rounded-md border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            <button
              onClick={() => setDrawingMode("fullset")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                drawingMode === "fullset"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              Full Set
            </button>
            <button
              onClick={() => setDrawingMode("discipline")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                drawingMode === "discipline"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              By Discipline
            </button>
          </div>
        </div>

        {/* Uploaded disciplines summary */}
        {drawingData?.uploads && drawingData.uploads.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {drawingData.uploads.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              >
                {DISCIPLINE_OPTIONS.find((d) => d.value === u.discipline)?.label ?? u.discipline}
                <span className="text-blue-400">({u.sheetCount})</span>
              </span>
            ))}
          </div>
        )}

        {drawingMode === "fullset" ? (
          <div>
            <UploadZone
              label="Full Drawing Set (auto-splits by discipline)"
              currentFileName={
                drawingData?.uploads?.find((u) => u.discipline === "FULLSET")?.fileName
                ?? drawingData?.drawingUpload?.fileName
              }
              uploading={splitting || drawingUploading}
              error={drawingUploadError}
              onFile={handleFullsetUpload}
            />
            {splitting && (
              <p className="text-xs text-zinc-500 mt-2 dark:text-zinc-400">
                Analyzing drawing set — detecting disciplines by sheet number prefix…
              </p>
            )}

            {/* Split confirmation */}
            {splitResult && (
              <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-900/20">
                <p className="text-sm font-medium text-blue-800 mb-2 dark:text-blue-200">
                  Detected {splitResult.disciplines.length} disciplines in {splitResult.total_pages} pages
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                  {splitResult.disciplines.map((d) => (
                    <div
                      key={d.discipline}
                      className="flex items-center justify-between rounded-md border border-blue-100 bg-white px-3 py-2 text-xs dark:border-blue-800 dark:bg-zinc-900"
                    >
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{d.label}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{d.page_count} sheets</span>
                    </div>
                  ))}
                  {splitResult.unidentified_pages.length > 0 && (
                    <div className="flex items-center justify-between rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-900/20">
                      <span className="font-medium text-amber-800 dark:text-amber-200">Unidentified</span>
                      <span className="text-amber-500">{splitResult.unidentified_pages.length} pages</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={confirmSplit}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Confirm &amp; Upload
                  </button>
                  <button
                    onClick={() => setSplitResult(null)}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {DISCIPLINE_OPTIONS.map((disc) => {
              const existing = drawingData?.uploads?.find((u) => u.discipline === disc.value);
              return (
                <UploadZone
                  key={disc.value}
                  label={disc.label}
                  currentFileName={existing?.fileName}
                  uploading={disciplineUploading === disc.value}
                  error={disciplineUploading === disc.value ? drawingUploadError : null}
                  onFile={(f) => uploadDrawing(f, disc.value)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ── Error states ── */}
      {specData?.specBook?.status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Spec book processing failed. Re-upload to try again.
        </div>
      )}
      {drawingData?.drawingUpload?.status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Drawing sheet index processing failed. Re-upload to try again.
        </div>
      )}

      {/* ── Summary bar ── */}
      {hasResults && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex flex-wrap gap-6">
            {specData?.specBook?.status === "ready" && (
              <span className="text-zinc-600 dark:text-zinc-300">
                <span className="font-semibold">{specData.total}</span>{" "}
                <span className="text-zinc-400 dark:text-zinc-500">spec sections</span>
              </span>
            )}
            {drawingData?.drawingUpload?.status === "ready" && (
              <span className="text-zinc-600 dark:text-zinc-300">
                <span className="font-semibold">{drawingData.total}</span>{" "}
                <span className="text-zinc-400 dark:text-zinc-500">drawing trade entries</span>
              </span>
            )}
            {totalCovered > 0 && (
              <span className="text-green-700">
                <span className="font-semibold">{totalCovered}</span>{" "}
                <span className="text-green-600">covered</span>
              </span>
            )}
            {totalMissing > 0 && (
              <span className="text-amber-700">
                <span className="font-semibold">{totalMissing}</span>{" "}
                <span className="text-amber-600">missing from bid</span>
              </span>
            )}
            {(specData?.unknownCount ?? 0) > 0 && (
              <span className="text-zinc-500 dark:text-zinc-400">
                <span className="font-semibold">{specData!.unknownCount}</span>{" "}
                <span>unknown</span>
              </span>
            )}
          </div>
          {specData?.specBook?.status === "ready" && (
            <button
              onClick={rematchSpec}
              disabled={specRematching}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              {specRematching ? "Re-matching…" : "Re-match trades"}
            </button>
          )}
        </div>
      )}

      {/* ── AI Spec Intelligence Results ── */}
      {specData?.aiAnalysis && (
        <AiSpecResults
          sections={[
            ...(specData.covered ?? []),
            ...(specData.missing ?? []),
            ...(specData.unknown ?? []),
          ].filter((s) => s.aiExtractions)}
          severity={specData.aiAnalysis.severity}
        />
      )}

      {/* ── Three-state coverage report ── */}
      {hasResults && (
        <div className="flex flex-col gap-3">
          {/* MISSING FROM BID — expanded by default */}
          <MissingSection
            rows={allMissing}
            addingIds={addingIds}
            onAddToBid={addToBid}
          />

          {/* COVERED — collapsed by default */}
          <CoveredSection
            rows={[
              ...(specData?.covered ?? []),
              ...(drawingData?.covered ?? []),
            ]}
          />

          {/* UNKNOWN — spec sections only */}
          {(specData?.unknown?.length ?? 0) > 0 && (
            <UnknownSection
              rows={specData!.unknown}
              allTrades={allTrades}
              assigningId={assigningId}
              onAssign={assignSection}
            />
          )}

          {/* All clear */}
          {totalMissing === 0 &&
            (specData?.unknownCount ?? 0) === 0 &&
            totalCovered > 0 && (
              <p className="text-sm text-green-700 font-medium">
                All documented trades are covered on this bid.
              </p>
            )}
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasResults && (
        <p className="text-sm text-zinc-400 italic dark:text-zinc-500">
          Upload a spec book or drawing sheet index to get started. Both are optional.
        </p>
      )}

      {/* ── Addendums ── */}
      <div className="flex flex-col gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Addendums</h2>

        {/* Upload form */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Addendum #</label>
            <input
              type="number"
              min={1}
              value={addendumNumber}
              onChange={(e) => setAddendumNumber(e.target.value)}
              placeholder="1"
              className="w-24 rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Date (optional)</label>
            <input
              type="date"
              value={addendumDate}
              onChange={(e) => setAddendumDate(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">PDF File</label>
            <input
              ref={addendumFileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAddendumUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => addendumFileRef.current?.click()}
              disabled={addendumUploading}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              {addendumUploading ? "Uploading…" : "Choose PDF"}
            </button>
          </div>
        </div>
        {addendumUploadError && (
          <p className="text-sm text-red-500">{addendumUploadError}</p>
        )}

        {/* Addendum list */}
        {addendums.length > 0 && (
          <div className="flex flex-col gap-2">
            {addendums.map((a) => {
              const delta: AddendumDelta | null = (() => {
                try { return a.deltaJson ? JSON.parse(a.deltaJson) : null; } catch { return null; }
              })();
              const isProcessed = !!delta;
              const isProcessing = processingDeltaId === a.id;
              const isExpanded = expandedDeltaId === a.id;
              const hasError = deltaError?.id === a.id;

              // Delta status badge
              let deltaStatusLabel = "Pending";
              let deltaStatusClass = "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
              if (isProcessing) {
                deltaStatusLabel = "Processing";
                deltaStatusClass = "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
              } else if (isProcessed) {
                deltaStatusLabel = "Processed";
                deltaStatusClass = "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
              }

              return (
                <div key={a.id} className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Addendum # */}
                    <span className="text-sm font-semibold text-zinc-700 w-6 shrink-0 dark:text-zinc-200">
                      {a.addendumNumber}
                    </span>

                    {/* File + date */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-700 truncate dark:text-zinc-200">{a.fileName}</p>
                      <p className="text-xs text-zinc-400 mt-0.5 dark:text-zinc-500">
                        {a.addendumDate
                          ? new Date(a.addendumDate).toLocaleDateString()
                          : "No date"}{" "}
                        · Uploaded {new Date(a.uploadedAt).toLocaleDateString()}
                      </p>
                      {isProcessed && a.summary && (
                        <p className="text-xs text-zinc-500 mt-1 italic dark:text-zinc-400">{a.summary}</p>
                      )}
                    </div>

                    {/* Upload status badge */}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "ready"
                          ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          : a.status === "error"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {a.status === "ready" ? "Extracted" : a.status}
                    </span>

                    {/* Delta status badge */}
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${deltaStatusClass}`}>
                      {deltaStatusLabel}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {!isProcessed && a.status === "ready" && (
                        <button
                          onClick={() => processDelta(a.id)}
                          disabled={isProcessing || !briefExists}
                          title={!briefExists ? "Generate the intelligence brief first" : undefined}
                          className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
                        >
                          {isProcessing ? "Processing…" : "Process Addendum"}
                        </button>
                      )}
                      {isProcessed && (
                        <button
                          onClick={() => setExpandedDeltaId(isExpanded ? null : a.id)}
                          className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-300"
                        >
                          {isExpanded ? "Hide Delta" : "View Delta"}
                        </button>
                      )}
                      <button
                        onClick={() => deleteAddendum(a.id)}
                        disabled={deletingAddendumId === a.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingAddendumId === a.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>

                  {/* Delta error */}
                  {hasError && (
                    <div className="border-t border-red-100 bg-red-50 px-4 py-2.5">
                      <p className="text-xs text-red-700">{deltaError!.message}</p>
                    </div>
                  )}

                  {/* No-brief warning */}
                  {!isProcessed && !briefExists && a.status === "ready" && (
                    <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      Generate the project intelligence brief on the Overview tab before processing this addendum.
                    </div>
                  )}

                  {/* Delta detail panel */}
                  {isExpanded && delta && (
                    <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-4 flex flex-col gap-4 dark:border-zinc-700 dark:bg-zinc-800">

                      {/* Net direction badges */}
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">Net Impact:</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          delta.netCostDirection === "INCREASE" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : delta.netCostDirection === "DECREASE" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}>
                          {delta.netCostDirection === "INCREASE" ? "↑" : delta.netCostDirection === "DECREASE" ? "↓" : "="} Cost {delta.netCostDirection}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          delta.netScheduleDirection === "INCREASE" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : delta.netScheduleDirection === "DECREASE" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}>
                          {delta.netScheduleDirection === "INCREASE" ? "↑" : delta.netScheduleDirection === "DECREASE" ? "↓" : "="} Schedule {delta.netScheduleDirection}
                        </span>
                      </div>

                      {/* Scope changes */}
                      {delta.scopeChanges?.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-wide dark:text-zinc-300">
                            Scope Changes ({delta.scopeChanges.length})
                          </h3>
                          {delta.scopeChanges.map((sc, i) => (
                            <div key={i} className="rounded border border-zinc-200 bg-white p-3 flex flex-col gap-1.5 dark:border-zinc-700 dark:bg-zinc-900">
                              <div className="flex flex-wrap gap-2 items-center">
                                <span className="rounded bg-zinc-800 text-white px-1.5 py-0.5 text-xs font-semibold">
                                  {sc.type}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  sc.costImpact === "INCREASE" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                  : sc.costImpact === "DECREASE" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                }`}>
                                  Cost: {sc.costImpact}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  sc.scheduleImpact === "INCREASE" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                  : sc.scheduleImpact === "DECREASE" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                }`}>
                                  Schedule: {sc.scheduleImpact}
                                </span>
                              </div>
                              <p className="text-sm text-zinc-800 dark:text-zinc-100">{sc.description}</p>
                              <p className="text-xs text-zinc-400 dark:text-zinc-500">{sc.location}</p>
                              <p className="text-xs text-zinc-600 border-t border-zinc-100 pt-1.5 mt-0.5 dark:text-zinc-300 dark:border-zinc-800">
                                <span className="font-medium">Action:</span> {sc.actionRequired}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* New risks */}
                      {delta.newRisks?.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-wide dark:text-zinc-300">
                            New Risks ({delta.newRisks.length})
                          </h3>
                          {delta.newRisks.map((r, i) => (
                            <div key={i} className="rounded border border-zinc-200 bg-white p-3 flex flex-col gap-1.5 dark:border-zinc-700 dark:bg-zinc-900">
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  r.severity === "CRITICAL" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                  : r.severity === "MODERATE" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                }`}>
                                  {r.severity}
                                </span>
                                <span className="text-xs text-zinc-400 dark:text-zinc-500">{r.sourceRef}</span>
                              </div>
                              <p className="text-sm text-zinc-800 dark:text-zinc-100">{r.description}</p>
                              <p className="text-xs text-zinc-600 border-t border-zinc-100 pt-1.5 mt-0.5 dark:text-zinc-300 dark:border-zinc-800">
                                <span className="font-medium">Recommended action:</span> {r.recommendedAction}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Clarifications */}
                      {delta.clarifications?.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-wide dark:text-zinc-300">
                            Clarifications ({delta.clarifications.length})
                          </h3>
                          {delta.clarifications.map((c, i) => (
                            <div key={i} className="rounded border border-zinc-200 bg-white p-3 flex flex-col gap-1 dark:border-zinc-700 dark:bg-zinc-900">
                              <p className="text-sm text-zinc-800 dark:text-zinc-100">{c.description}</p>
                              <p className="text-xs text-zinc-400 dark:text-zinc-500">{c.location}</p>
                              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                                <span className="font-medium">Action:</span> {c.actionRequired}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Resolved items */}
                      {delta.resolvedItems?.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-wide dark:text-zinc-300">
                            Resolved Items
                          </h3>
                          <ul className="flex flex-col gap-1">
                            {delta.resolvedItems.map((item, i) => (
                              <li key={i} className="flex gap-2 items-start text-xs text-zinc-600 dark:text-zinc-300">
                                <span className="text-green-600 font-bold shrink-0 mt-0.5">✓</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Actions required — checklist */}
                      {delta.actionsRequired?.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-wide dark:text-zinc-300">
                            Actions Required
                          </h3>
                          <ul className="flex flex-col gap-1.5">
                            {delta.actionsRequired.map((action, i) => {
                              const key = `${a.id}-${i}`;
                              const checked = !!checkedActions[key];
                              return (
                                <li
                                  key={i}
                                  className="flex gap-2 items-start cursor-pointer"
                                  onClick={() =>
                                    setCheckedActions((prev) => ({ ...prev, [key]: !prev[key] }))
                                  }
                                >
                                  <span className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-xs ${
                                    checked
                                      ? "border-green-500 bg-green-500 text-white"
                                      : "border-zinc-300 bg-white text-transparent"
                                  }`}>
                                    ✓
                                  </span>
                                  <span className={`text-xs ${checked ? "line-through text-zinc-400" : "text-zinc-700"}`}>
                                    {action}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {addendums.length === 0 && (
          <p className="text-sm text-zinc-400 italic dark:text-zinc-500">
            No addendums uploaded. Add addendums as they are issued.
          </p>
        )}
      </div>
    </div>
  );
}
