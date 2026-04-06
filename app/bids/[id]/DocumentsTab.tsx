"use client";

import { useEffect, useRef, useState } from "react";

type Trade = { id: number; name: string };
type BidTrade = { id: number; tradeId: number; trade: Trade };

type SpecBookMeta = {
  id: number;
  fileName: string;
  status: "processing" | "ready" | "error";
  uploadedAt: string;
};

type GapSection = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  tradeId: number | null;
  trade: Trade | null;
};

type GapsData = {
  specBook: SpecBookMeta;
  total: number;
  covered: number;
  gapCount: number;
  gaps: GapSection[];
};

export default function DocumentsTab({
  bidId,
  bidTrades,
}: {
  bidId: number;
  bidTrades: BidTrade[];
}) {
  const [data, setData] = useState<GapsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [rematching, setRematching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trades = bidTrades.map((bt) => bt.trade);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/specbook/gaps`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json() as Promise<GapsData | null>;
      })
      .then((d) => {
        setData(d ?? null);
        setLoading(false);
      })
      .catch((e: Error) => {
        setFetchError(e.message);
        setLoading(false);
      });
  }, [bidId]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/bids/${bidId}/specbook/upload`, {
        method: "POST",
        body: form,
      });
      const result = await res.json();
      if (!res.ok) {
        setUploadError(result.error ?? "Upload failed");
      } else {
        // Reload gaps after successful upload
        const gaps: GapsData | null = await fetch(`/api/bids/${bidId}/specbook/gaps`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        setData(gaps);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function assignTrade(sectionId: number, tradeId: number | null) {
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
      const updated: { covered: boolean; tradeId: number | null; trade: Trade | null } =
        await res.json();

      setData((prev) => {
        if (!prev) return prev;
        if (updated.covered) {
          // Section is now covered — remove from gap list, increment covered count
          return {
            ...prev,
            covered: prev.covered + 1,
            gapCount: prev.gapCount - 1,
            gaps: prev.gaps.filter((g) => g.id !== sectionId),
          };
        }
        // Cleared assignment — update the row in place
        return {
          ...prev,
          gaps: prev.gaps.map((g) =>
            g.id === sectionId
              ? { ...g, tradeId: updated.tradeId, trade: updated.trade }
              : g
          ),
        };
      });
    } finally {
      setAssigningId(null);
    }
  }

  async function rematch() {
    setRematching(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/specbook/rematch`, { method: "POST" });
      if (res.ok) {
        const gaps: GapsData | null = await fetch(`/api/bids/${bidId}/specbook/gaps`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        setData(gaps);
      }
    } finally {
      setRematching(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (fetchError) return <p className="text-sm text-red-500">Error: {fetchError}</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Upload zone ── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Spec Book</h2>
        <div
          className="rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center hover:border-zinc-400 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) handleUpload(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <p className="text-sm text-zinc-500">Uploading and parsing…</p>
          ) : (
            <>
              <p className="text-sm text-zinc-600 font-medium">
                {data?.specBook ? "Replace spec book" : "Upload spec book PDF"}
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                PDF only · Drop file here or click to browse
              </p>
              {data?.specBook && (
                <p className="text-xs text-zinc-400 mt-2">
                  Current: {data.specBook.fileName}
                </p>
              )}
            </>
          )}
        </div>
        {uploadError && (
          <p className="text-sm text-red-500 mt-2">{uploadError}</p>
        )}
      </section>

      {/* ── Results ── */}
      {data?.specBook && (
        <>
          {data.specBook.status === "error" && (
            <div className="rounded-md border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
              Processing failed. Re-upload the spec book to try again.
            </div>
          )}

          {data.specBook.status === "ready" && (
            <>
              {/* Summary bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-zinc-200 bg-zinc-50 px-5 py-3 text-sm">
              <div className="flex flex-wrap gap-6">
                <span className="text-zinc-700">
                  <span className="font-semibold">{data.total}</span>{" "}
                  <span className="text-zinc-500">sections found</span>
                </span>
                <span className="text-green-700">
                  <span className="font-semibold">{data.covered}</span>{" "}
                  <span className="text-green-600">covered</span>
                </span>
                {data.gapCount > 0 ? (
                  <span className="text-red-700">
                    <span className="font-semibold">{data.gapCount}</span>{" "}
                    <span className="text-red-600">
                      gap{data.gapCount !== 1 ? "s" : ""}
                    </span>
                  </span>
                ) : (
                  data.total > 0 && (
                    <span className="font-medium text-green-700">
                      All sections covered
                    </span>
                  )
                )}
              </div>
                <button
                  onClick={rematch}
                  disabled={rematching}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                >
                  {rematching ? "Re-matching…" : "Re-match trades"}
                </button>
              </div>

              {/* Gap table */}
              {data.gaps.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                    Coverage Gaps ({data.gaps.length})
                  </h3>
                  <div className="border border-zinc-200 rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                        <tr>
                          <th className="px-4 py-3 border-b border-zinc-200 w-28">
                            CSI
                          </th>
                          <th className="px-4 py-3 border-b border-zinc-200">
                            Section Title
                          </th>
                          <th className="px-4 py-3 border-b border-zinc-200 w-52">
                            Assign Trade
                          </th>
                          <th className="px-4 py-3 border-b border-zinc-200 w-20">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.gaps.map((gap) => (
                          <tr
                            key={gap.id}
                            className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                          >
                            <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                              {gap.csiNumber}
                            </td>
                            <td className="px-4 py-3 text-zinc-700">
                              {gap.csiTitle}
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={gap.tradeId ?? ""}
                                disabled={assigningId === gap.id}
                                onChange={(e) =>
                                  assignTrade(
                                    gap.id,
                                    e.target.value === ""
                                      ? null
                                      : parseInt(e.target.value, 10)
                                  )
                                }
                                className="w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
                              >
                                <option value="">— Unassigned</option>
                                {trades.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                                Gap
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {data.gaps.length === 0 && data.total > 0 && (
                <p className="text-sm text-zinc-400 italic">
                  No gaps — all spec sections have a trade assigned.
                </p>
              )}

              {data.total === 0 && (
                <p className="text-sm text-zinc-400 italic">
                  No CSI section headers detected. Verify this is a MasterFormat
                  spec book.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
