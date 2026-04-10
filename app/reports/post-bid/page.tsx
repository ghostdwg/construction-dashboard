"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

type Summary = {
  totalSubmitted: number;
  won: number;
  lost: number;
  withdrawn: number;
  pending: number;
  winRate: number;
  avgRank: number | null;
  avgGapToWinner: number | null;
};

type ProjectTypeStats = {
  submitted: number;
  won: number;
  lost: number;
  winRate: number;
};

type LostReason = { reason: string; count: number };

type RecentBid = {
  id: number;
  projectName: string;
  projectType: string;
  outcome: string | null;
  ourBidAmount: number | null;
  winningBidAmount: number | null;
  submittedAt: string;
  outcomeAt: string | null;
};

type PostBidData = {
  summary: Summary;
  byProjectType: Record<string, ProjectTypeStats>;
  lostReasons: LostReason[];
  recentBids: RecentBid[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString();
}

const OUTCOME_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  won: { bg: "bg-green-100", text: "text-green-700", label: "Won" },
  lost: { bg: "bg-red-100", text: "text-red-700", label: "Lost" },
  withdrawn: { bg: "bg-zinc-100", text: "text-zinc-600", label: "Withdrawn" },
  no_decision: { bg: "bg-blue-100", text: "text-blue-700", label: "Pending" },
};

const REASON_LABELS: Record<string, string> = {
  price: "Price",
  scope: "Scope",
  schedule: "Schedule",
  relationship: "Relationship",
  other: "Other",
};

// ── Main page ──────────────────────────────────────────────────────────────

export default function PostBidReportsPage() {
  const [data, setData] = useState<PostBidData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reports/post-bid")
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-10 px-4">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (!data || data.summary.totalSubmitted === 0) {
    return (
      <div className="max-w-6xl mx-auto py-10 px-4">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/reports" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Reports</Link>
        </div>
        <h1 className="text-2xl font-semibold mb-2">Post-Bid Analytics</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No submitted bids yet. Submit a bid to start tracking outcomes.</p>
      </div>
    );
  }

  const { summary, byProjectType, lostReasons, recentBids } = data;
  const maxReasonCount = Math.max(...lostReasons.map((r) => r.count), 1);

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/reports" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Reports</Link>
      </div>
      <h1 className="text-2xl font-semibold mb-8">Post-Bid Analytics</h1>

      {/* Summary cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <SummaryCard label="Total Submitted" value={summary.totalSubmitted.toString()} />
        <SummaryCard label="Win Rate" value={`${summary.winRate}%`} accent={summary.winRate >= 30 ? "green" : "amber"} />
        <SummaryCard label="Won / Lost" value={`${summary.won} / ${summary.lost}`} />
        <SummaryCard
          label="Avg Gap to Winner"
          value={summary.avgGapToWinner != null ? `${summary.avgGapToWinner > 0 ? "+" : ""}${summary.avgGapToWinner}%` : "—"}
          hint={summary.avgRank != null ? `Avg rank: ${summary.avgRank}` : undefined}
        />
      </section>

      {/* By project type */}
      <section className="mb-10">
        <h2 className="text-base font-semibold mb-4">By Project Type</h2>
        <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Submitted</th>
                <th className="px-4 py-2.5 text-right">Won</th>
                <th className="px-4 py-2.5 text-right">Lost</th>
                <th className="px-4 py-2.5 text-right">Win Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {Object.entries(byProjectType).map(([type, stats]) => (
                <tr key={type}>
                  <td className="px-4 py-2.5 font-medium">{type}</td>
                  <td className="px-4 py-2.5 text-right">{stats.submitted}</td>
                  <td className="px-4 py-2.5 text-right text-green-600">{stats.won}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{stats.lost}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{stats.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lost reasons */}
      {lostReasons.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold mb-4">Lost Reasons</h2>
          <div className="rounded-md border border-zinc-200 p-4 bg-white flex flex-col gap-3 dark:border-zinc-700 dark:bg-zinc-900">
            {lostReasons.map((r) => (
              <div key={r.reason} className="flex items-center gap-3">
                <span className="text-sm text-zinc-700 w-28 dark:text-zinc-200">{REASON_LABELS[r.reason] ?? r.reason}</span>
                <div className="flex-1 bg-zinc-100 rounded-full h-3 relative dark:bg-zinc-800">
                  <div
                    className="bg-red-400 h-3 rounded-full"
                    style={{ width: `${(r.count / maxReasonCount) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-zinc-700 w-8 text-right dark:text-zinc-200">{r.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent submissions */}
      <section>
        <h2 className="text-base font-semibold mb-4">Recent Submissions</h2>
        <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Submitted</th>
                <th className="px-4 py-2.5 text-right">Our Bid</th>
                <th className="px-4 py-2.5 text-right">Winning</th>
                <th className="px-4 py-2.5">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recentBids.map((b) => {
                const style = b.outcome ? OUTCOME_STYLES[b.outcome] : null;
                return (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/bids/${b.id}`} className="text-zinc-700 hover:underline dark:text-zinc-200">
                        {b.projectName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs dark:text-zinc-400">{b.projectType}</td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs dark:text-zinc-400">
                      {new Date(b.submittedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-700 dark:text-zinc-200">{fmtDollar(b.ourBidAmount)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 dark:text-zinc-400">{fmtDollar(b.winningBidAmount)}</td>
                    <td className="px-4 py-2.5">
                      {style ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Summary card ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "green" | "amber" | "red";
}) {
  const accentClass = accent === "green"
    ? "border-green-200 bg-green-50"
    : accent === "amber"
    ? "border-amber-200 bg-amber-50"
    : accent === "red"
    ? "border-red-200 bg-red-50"
    : "border-zinc-200 bg-white";

  return (
    <div className={`rounded-md border px-5 py-4 ${accentClass}`}>
      <p className="text-2xl font-semibold text-zinc-800 dark:text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-500 mt-1 dark:text-zinc-400">{label}</p>
      {hint && <p className="text-[10px] text-zinc-400 mt-0.5 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}
