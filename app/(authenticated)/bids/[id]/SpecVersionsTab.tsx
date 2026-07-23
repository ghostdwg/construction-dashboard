"use client";

import { useCallback, useEffect, useState } from "react";

type SpecRevision = {
  id: number;
  fileName: string;
  revisionIndex: number | null;
  effectiveState: string | null;
  sha256: string | null;
  byteSize: number | null;
  activeSlot: number | null;
};
type AddendumRevision = {
  id: number;
  addendumNumber: number;
  fileName: string;
  revisionIndex: number | null;
  effectiveState: string | null;
  sha256: string | null;
  byteSize: number | null;
  activeSlot: number | null;
};
type EffectiveSet = {
  id: number;
  versionNumber: number;
  status: string;
  manifestSha256: string;
  baseSpecBook: SpecRevision;
  addenda: Array<{
    ordinal: number;
    addendumUpload: AddendumRevision;
  }>;
};
type VersionsResponse = {
  specRevisions: SpecRevision[];
  addendumRevisions: AddendumRevision[];
  effectiveSets: EffectiveSet[];
};

const shortHash = (value: string | null) => (value ? value.slice(0, 12) : "unknown");

export default function SpecVersionsTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<VersionsResponse | null>(null);
  const [baseId, setBaseId] = useState<number | null>(null);
  const [orderedAddenda, setOrderedAddenda] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/bids/${bidId}/spec-evidence/versions`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as VersionsResponse;
    setData(body);
    setBaseId((current) => current ?? body.specRevisions.find((row) => row.activeSlot === 1)?.id ?? null);
    setOrderedAddenda((current) =>
      current.length > 0
        ? current
        : body.addendumRevisions
            .filter((row) => row.activeSlot === 1)
            .sort((a, b) => a.addendumNumber - b.addendumNumber)
            .map((row) => row.id),
    );
  }, [bidId]);

  useEffect(() => {
    load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [load]);

  function toggleAddendum(id: number) {
    setOrderedAddenda((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function move(id: number, delta: number) {
    setOrderedAddenda((current) => {
      const from = current.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  async function publish() {
    if (!baseId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/bids/${bidId}/spec-evidence/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseSpecBookId: baseId,
          addendumUploadIds: orderedAddenda,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="text-sm text-zinc-500">Loading versions…</p>;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-base font-semibold">Addenda / versions</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Publishing freezes an exact base revision and the addenda order shown here.
        </p>
      </header>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Publish effective manifest</h3>
        <label className="mt-3 block text-xs font-medium text-zinc-500">Base Spec revision</label>
        <select
          value={baseId ?? ""}
          onChange={(event) => setBaseId(Number(event.target.value))}
          className="mt-1 w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-600"
        >
          <option value="" disabled>Select a source revision</option>
          {data?.specRevisions.map((revision) => (
            <option key={revision.id} value={revision.id}>
              r{revision.revisionIndex ?? "legacy"} · {revision.fileName} · {shortHash(revision.sha256)}
            </option>
          ))}
        </select>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-zinc-500">Ordered addenda</p>
          {data?.addendumRevisions.map((revision) => {
            const selectedIndex = orderedAddenda.indexOf(revision.id);
            return (
              <div key={revision.id} className="flex items-center gap-2 rounded border border-zinc-200 p-2 text-sm dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={selectedIndex >= 0}
                  onChange={() => toggleAddendum(revision.id)}
                />
                <span className="flex-1">
                  Addendum {revision.addendumNumber} r{revision.revisionIndex ?? "legacy"} · {revision.fileName}
                </span>
                {selectedIndex >= 0 && (
                  <>
                    <span className="text-xs text-zinc-500">#{selectedIndex + 1}</span>
                    <button type="button" onClick={() => move(revision.id, -1)} aria-label="Move up">↑</button>
                    <button type="button" onClick={() => move(revision.id, 1)} aria-label="Move down">↓</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          disabled={busy || !baseId}
          onClick={publish}
          className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Publish manifest
        </button>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Manifest history</h3>
        <div className="space-y-3">
          {data?.effectiveSets.map((set) => (
            <article key={set.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-sm font-semibold">
                Effective Set {set.versionNumber} · {set.status}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Base r{set.baseSpecBook.revisionIndex ?? "legacy"} · manifest SHA {shortHash(set.manifestSha256)}
              </p>
              <ol className="mt-2 list-decimal pl-5 text-xs text-zinc-600 dark:text-zinc-300">
                {set.addenda.map((entry) => (
                  <li key={entry.addendumUpload.id}>
                    Addendum {entry.addendumUpload.addendumNumber} r
                    {entry.addendumUpload.revisionIndex ?? "legacy"}
                  </li>
                ))}
              </ol>
            </article>
          ))}
          {data?.effectiveSets.length === 0 && (
            <p className="text-sm text-zinc-500">No effective manifests published.</p>
          )}
        </div>
      </section>
    </div>
  );
}
