"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Trade = { id: number; name: string };

type SectionRow = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  tradeId: number | null;
  trade: Trade | null;
  matchedTradeId: number | null;
  matchedTrade: Trade | null;
  source: string | null;
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

type DrawingData = {
  drawingUpload: DrawingUploadMeta;
  total: number;
  coveredCount: number;
  missingCount: number;
  covered: DrawingSheetRow[];
  missing: DrawingSheetRow[];
};

type AddendumRow = {
  id: number;
  addendumNumber: number;
  addendumDate: string | null;
  fileName: string;
  uploadedAt: string;
  status: string;
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
      <h2 className="text-sm font-semibold text-zinc-700 mb-2">{label}</h2>
      <div
        className="rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center hover:border-zinc-400 transition-colors cursor-pointer"
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
          <p className="text-sm text-zinc-500">Uploading and parsing…</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 font-medium">
              {currentFileName ? "Replace" : "Upload"} PDF
            </p>
            <p className="text-xs text-zinc-400 mt-1">Drop here or click to browse</p>
            {currentFileName && (
              <p className="text-xs text-zinc-400 mt-1">Current: {currentFileName}</p>
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
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-green-800 hover:bg-green-100 transition-colors"
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
              className="shrink-0 rounded border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50 transition-colors"
            >
              {adding ? "Adding…" : "Add to Bid"}
            </button>
          </div>
        );
      })}
    </div>
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
    <div className="rounded-md border border-zinc-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-200 bg-zinc-50">
        <span className="text-sm font-medium text-zinc-700">
          Unknown — {rows.length} section{rows.length !== 1 ? "s" : ""}
        </span>
        <p className="text-xs text-zinc-500 mt-0.5">
          No trade in the dictionary matches these CSI sections. Assign manually.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide border-b border-zinc-200">
          <tr>
            <th className="px-4 py-2.5 w-24">CSI</th>
            <th className="px-4 py-2.5">Section</th>
            <th className="px-4 py-2.5 w-52">Assign Trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
              <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">{row.csiNumber}</td>
              <td className="px-4 py-2.5 text-zinc-700">{row.csiTitle}</td>
              <td className="px-4 py-2.5">
                <select
                  defaultValue=""
                  disabled={assigningId === row.id}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) onAssign(row.id, val);
                    e.target.value = "";
                  }}
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
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
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUploadError, setDrawingUploadError] = useState<string | null>(null);

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
  const [briefIsStale, setBriefIsStale] = useState(false);
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
    // Check if brief is stale
    fetch(`/api/bids/${bidId}/intelligence`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { brief: { isStale?: boolean; status?: string } | null } | null) => {
        if (data?.brief?.isStale || data?.brief?.status === "generating") {
          setBriefIsStale(true);
        }
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

  // ── Drawing upload ─────────────────────────────────────────────────────────

  async function handleDrawingUpload(file: File) {
    setDrawingUploading(true);
    setDrawingUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/bids/${bidId}/drawings/upload`, { method: "POST", body: form });
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

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
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

      {/* ── Upload zones ── */}
      <div className="flex gap-4">
        <UploadZone
          label="Spec Book"
          currentFileName={specData?.specBook?.fileName}
          uploading={specUploading}
          error={specUploadError}
          onFile={handleSpecUpload}
        />
        <UploadZone
          label="Drawing Sheet Index"
          currentFileName={drawingData?.drawingUpload?.fileName}
          uploading={drawingUploading}
          error={drawingUploadError}
          onFile={handleDrawingUpload}
        />
      </div>

      {/* ── Error states ── */}
      {specData?.specBook?.status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Spec book processing failed. Re-upload to try again.
        </div>
      )}
      {drawingData?.drawingUpload?.status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Drawing sheet index processing failed. Re-upload to try again.
        </div>
      )}

      {/* ── Summary bar ── */}
      {hasResults && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm">
          <div className="flex flex-wrap gap-6">
            {specData?.specBook?.status === "ready" && (
              <span className="text-zinc-600">
                <span className="font-semibold">{specData.total}</span>{" "}
                <span className="text-zinc-400">spec sections</span>
              </span>
            )}
            {drawingData?.drawingUpload?.status === "ready" && (
              <span className="text-zinc-600">
                <span className="font-semibold">{drawingData.total}</span>{" "}
                <span className="text-zinc-400">drawing trade entries</span>
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
              <span className="text-zinc-500">
                <span className="font-semibold">{specData!.unknownCount}</span>{" "}
                <span>unknown</span>
              </span>
            )}
          </div>
          {specData?.specBook?.status === "ready" && (
            <button
              onClick={rematchSpec}
              disabled={specRematching}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
            >
              {specRematching ? "Re-matching…" : "Re-match trades"}
            </button>
          )}
        </div>
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
        <p className="text-sm text-zinc-400 italic">
          Upload a spec book or drawing sheet index to get started. Both are optional.
        </p>
      )}

      {/* ── Addendums ── */}
      <div className="flex flex-col gap-3 pt-2 border-t border-zinc-200">
        <h2 className="text-sm font-semibold text-zinc-700">Addendums</h2>

        {briefIsStale && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            Brief is regenerating with latest addendum…
          </div>
        )}

        {/* Upload form */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Addendum #</label>
            <input
              type="number"
              min={1}
              value={addendumNumber}
              onChange={(e) => setAddendumNumber(e.target.value)}
              placeholder="1"
              className="w-24 rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Date (optional)</label>
            <input
              type="date"
              value={addendumDate}
              onChange={(e) => setAddendumDate(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">PDF File</label>
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
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
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
          <div className="rounded-md border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left w-20">#</th>
                  <th className="px-4 py-2.5 text-left w-32">Date</th>
                  <th className="px-4 py-2.5 text-left">File</th>
                  <th className="px-4 py-2.5 text-left w-24">Status</th>
                  <th className="px-4 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {addendums.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-zinc-700">{a.addendumNumber}</td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {a.addendumDate
                        ? new Date(a.addendumDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 truncate max-w-xs">{a.fileName}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.status === "ready"
                            ? "bg-green-100 text-green-700"
                            : a.status === "error"
                            ? "bg-red-100 text-red-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => deleteAddendum(a.id)}
                        disabled={deletingAddendumId === a.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingAddendumId === a.id ? "…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {addendums.length === 0 && (
          <p className="text-sm text-zinc-400 italic">
            No addendums uploaded. Add addendums as they are issued.
          </p>
        )}
      </div>
    </div>
  );
}
