"use client";

import { useEffect, useState } from "react";

type Paragraph = {
  id: number;
  ordinal: number;
  paragraphLabel: string;
  text: string;
  pageNumber: number | null;
  pageEnd: number | null;
  textSha256: string;
};
type Section = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  evidenceRevisions: Array<{
    id: number;
    revisionIndex: number;
    textSha256: string;
    pageStart: number | null;
    pageEnd: number | null;
    paragraphs: Paragraph[];
  }>;
};
type SectionsResponse = {
  effectiveSet: {
    versionNumber: number;
    manifestSha256: string;
    baseSpecBook: {
      fileName: string;
      revisionIndex: number | null;
      sha256: string | null;
      byteSize: number | null;
      sections: Section[];
    };
  } | null;
};

const shortHash = (value: string | null) => (value ? value.slice(0, 12) : "unknown");

export default function SpecSectionsTab({ bidId }: { bidId: number }) {
  const [data, setData] = useState<SectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bids/${bidId}/spec-evidence/sections`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<SectionsResponse>;
      })
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [bidId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Loading section evidence…</p>;
  if (!data.effectiveSet) {
    return (
      <EmptyState
        title="No published Spec manifest"
        detail="Publish an exact base revision and ordered addenda in Addenda / Versions first."
      />
    );
  }

  const { baseSpecBook } = data.effectiveSet;
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Section evidence
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Effective Set {data.effectiveSet.versionNumber} · {baseSpecBook.fileName} · source
          revision {baseSpecBook.revisionIndex ?? "legacy"} · SHA {shortHash(baseSpecBook.sha256)}
        </p>
      </header>
      {baseSpecBook.sections.length === 0 ? (
        <EmptyState title="No section evidence" detail="Split or parse the selected Spec revision." />
      ) : (
        <div className="space-y-3">
          {baseSpecBook.sections.map((section) => {
            const evidence = section.evidenceRevisions[0];
            return (
              <details
                key={section.id}
                className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
              >
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {section.csiNumber} — {section.csiTitle}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {evidence
                      ? `${evidence.paragraphs.length} paragraphs · evidence r${evidence.revisionIndex}`
                      : "no retained evidence"}
                  </span>
                </summary>
                {evidence && (
                  <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
                    <p className="mb-3 font-mono text-[11px] text-zinc-500">
                      text SHA {evidence.textSha256} · pages {evidence.pageStart ?? "?"}–
                      {evidence.pageEnd ?? "?"}
                    </p>
                    <div className="space-y-3">
                      {evidence.paragraphs.map((paragraph) => (
                        <article key={paragraph.id} className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/60">
                          <p className="text-xs font-semibold text-blue-600">
                            {paragraph.paragraphLabel}
                            {paragraph.pageNumber ? ` · p.${paragraph.pageNumber}` : ""}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">
                            {paragraph.text}
                          </p>
                          <p className="mt-2 font-mono text-[10px] text-zinc-400">
                            {shortHash(paragraph.textSha256)}
                          </p>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </section>
  );
}
