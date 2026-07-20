// ──────────────────────────────────────────────────────────────────────────────
//  app/(authenticated)/market-intelligence/PromotionSummary.tsx
//  Source-side "pursuit created" summary + promotion audit history.
//
//  Server component. Renders only for a source that HAS been promoted and whose
//  pursuit the caller may see — the page passes null for out-of-scope
//  promotions, so this never becomes a cross-scope disclosure channel.
//
//  Shows the operator what happened and when, without pulling any bid-side
//  detail into the Market Intelligence wing: the pursuit appears as an id and a
//  link, never as its scope, budget, subs or documents.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  getPromotionHistory,
  getPursuitOrigin,
} from "@/lib/services/pursuitPromotion";
import { pursuitHref, type PromotionSourceKind } from "@/lib/services/pursuitPromotion/types";

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

const ACTION_LABELS: Record<string, string> = {
  promote_to_pursuit: "Promoted to pursuit",
  promote_to_pursuit_reused: "Repeat attempt — existing pursuit returned",
};

export default async function PromotionSummary({
  sourceKind,
  sourceId,
  bidId,
}: {
  sourceKind: PromotionSourceKind;
  sourceId: string;
  bidId: number;
}) {
  const [origin, history] = await Promise.all([
    getPursuitOrigin(bidId),
    getPromotionHistory(sourceKind, sourceId),
  ]);

  return (
    <div
      className="flex flex-col gap-3 p-3 rounded"
      style={{ border: "1px solid var(--line)", background: "rgba(255,255,255,0.02)" }}
    >
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Pursuit">
          <Link
            href={pursuitHref(bidId)}
            className="hover:underline"
            style={{ color: "var(--signal)" }}
          >
            #{bidId}
          </Link>
        </Field>
        <Field label="Promoted">{fmtDateTime(origin?.promotedAt ?? null)}</Field>
        <Field label="Promoted by">
          {origin?.actorEmail ?? origin?.actorUserId ?? "—"}
        </Field>
      </dl>

      {history.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
            Promotion history
          </p>
          <ol className="flex flex-col gap-1">
            {history.map((h, i) => (
              <li
                key={`${h.action}-${i}`}
                className="flex flex-wrap items-baseline gap-2 text-[11px]"
                style={{ color: "var(--text-dim)" }}
              >
                <span style={{ color: "var(--text)" }}>
                  {ACTION_LABELS[h.action] ?? h.action}
                </span>
                <span>{fmtDateTime(h.emittedAt)}</span>
                {h.actorEmail && <span>· {h.actorEmail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.07em] opacity-60">
        {label}
      </dt>
      <dd className="text-sm" style={{ color: "var(--text)" }}>
        {children}
      </dd>
    </div>
  );
}
