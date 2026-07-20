"use client";

import { useEffect, useState } from "react";

type SpecGapSection = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  submittalsCount: number;
};

// Inline hint panel: shows uncovered spec sections that keyword-match the given
// title. Debounced 400 ms. Hidden when title is too short or no sections match.
// Purely informational — does not block item creation.
export default function SpecGapHint({ bidId, title }: { bidId: number; title: string }) {
  const [sections, setSections] = useState<SpecGapSection[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hasSearchTerm = title.trim().length >= 3;
    const tid = setTimeout(() => {
      if (!hasSearchTerm) {
        setSections([]);
        setTotal(0);
        setOpen(false);
        return;
      }
      void fetch(
        `/api/bids/${bidId}/spec-gaps/related?q=${encodeURIComponent(title)}&limit=5`
      )
        .then((r) => (r.ok ? (r.json() as Promise<{ sections: SpecGapSection[]; total: number }>) : null))
        .then((json) => {
          if (!json) return;
          setSections(json.sections);
          setTotal(json.total);
        })
        .catch(() => {});
    }, hasSearchTerm ? 400 : 0);
    return () => clearTimeout(tid);
  }, [bidId, title]);

  if (total === 0) return null;

  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-950">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-left text-amber-700 dark:text-amber-300"
      >
        <span aria-hidden>⚠</span>
        <span>
          {total} spec section{total === 1 ? "" : "s"} may relate to this item
        </span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-4">
          {sections.map((s) => (
            <li key={s.id} className="text-amber-800 dark:text-amber-200">
              <span className="font-mono">{s.csiNumber}</span> — {s.csiTitle}
              {s.submittalsCount > 0 && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  ({s.submittalsCount} submittal{s.submittalsCount === 1 ? "" : "s"})
                </span>
              )}
            </li>
          ))}
          {total > sections.length && (
            <li className="text-amber-600 dark:text-amber-400">
              …and {total - sections.length} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
