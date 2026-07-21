// ──────────────────────────────────────────────────────────────────────────────
//  app/(authenticated)/bids/[id]/PursuitOriginCard.tsx
//  Pursuit-side provenance — "where did this pursuit come from?"
//
//  Server component. Renders nothing for pursuits created directly, so the
//  Overview tab is unchanged for every pre-existing bid.
//
//  Only public market-source facts appear here (title, source URL, source doc,
//  who promoted it, when). Nothing bid-side flows in the other direction —
//  getPursuitOrigin() reads market rows only.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { getPursuitOrigin } from "@/lib/services/pursuitPromotion";
import { marketSourceHref } from "@/lib/services/pursuitPromotion/types";

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default async function PursuitOriginCard({ bidId }: { bidId: number }) {
  const origin = await getPursuitOrigin(bidId);
  if (!origin) return null;

  const sourceHref = marketSourceHref(origin.sourceKind, origin.sourceId);

  // Both promotion sources are intelligence-derived emerging projects; the
  // pursuit shows its Market Intelligence origin, not a CRM "lead".
  const kindLabel = "Market Intelligence — Emerging project";

  return (
    <section
      aria-label="Pursuit origin"
      className="flex flex-col gap-2 rounded border border-zinc-200 dark:border-zinc-700 p-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500 select-none">
          Origin
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-600 dark:text-zinc-300">
          {kindLabel}
        </span>
      </div>

      <Link
        href={sourceHref}
        className="text-sm hover:underline text-zinc-800 dark:text-zinc-100"
      >
        ↗ {origin.sourceTitle}
      </Link>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Promoted" value={fmtDateTime(origin.promotedAt)} />
        <Field label="Promoted by" value={origin.actorEmail ?? origin.actorUserId ?? "—"} />
        {origin.sourceDocId && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              Source document
            </dt>
            <dd className="text-xs">
              <Link
                href={`/market-intelligence/docs/${origin.sourceDocId}`}
                className="hover:underline text-zinc-800 dark:text-zinc-100"
              >
                View document
              </Link>
            </dd>
          </div>
        )}
      </dl>

      {origin.sourceUrl && (
        <a
          href={origin.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] truncate text-zinc-500 dark:text-zinc-400 hover:underline"
        >
          {origin.sourceUrl}
        </a>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="text-xs text-zinc-700 dark:text-zinc-200">{value}</dd>
    </div>
  );
}
