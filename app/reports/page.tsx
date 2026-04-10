"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ---- Types ----

type Summary = {
  activeBids: number;
  tradesNoCoverage: number;
  openQuestions: number;
  unansweredQuestions: number;
  gapFindings: number;
  exportsThisMonth: number;
};

type BidByStatus = { status: string; count: number };

type TradeCoverageRow = {
  bidId: number;
  bidName: string;
  dueDate: string | null;
  tradeId: number;
  tradeName: string;
  subCount: number;
};

type ResponseRate = {
  tradeName: string;
  exported: number;
  responded: number;
  rate: number;
};

type AgingRow = {
  id: number;
  company: string;
  tradeName: string;
  bidName: string;
  lastActivity: string;
  daysSince: number;
  status: string;
};

// ---- Constants ----

const STATUS_COLORS: Record<string, string> = {
  draft: "#a1a1aa",
  in_progress: "#3b82f6",
  ready_for_invite: "#eab308",
  invited: "#22c55e",
  under_review: "#a855f7",
  awarded: "#15803d",
  cancelled: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  ready_for_invite: "Ready",
  invited: "Invited",
  under_review: "Under Review",
  awarded: "Awarded",
  cancelled: "Cancelled",
};

// ---- Summary card ----

function SummaryCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-5 py-4 ${
        warn && value > 0
          ? "border-amber-300 bg-amber-50"
          : "border-zinc-200 bg-white"
      }`}
    >
      <p className={`text-3xl font-semibold ${warn && value > 0 ? "text-amber-700" : ""}`}>
        {value}
      </p>
      <p className="text-xs text-zinc-500 mt-1 dark:text-zinc-400">{label}</p>
    </div>
  );
}

// ---- Section wrapper ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-base font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

// ---- Main page ----

export default function ReportsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bidsByStatus, setBidsByStatus] = useState<BidByStatus[]>([]);
  const [coverage, setCoverage] = useState<TradeCoverageRow[]>([]);
  const [rates, setRates] = useState<ResponseRate[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [s, b, c, r, a] = await Promise.all([
          fetch("/api/reports/summary").then((r) => r.json()),
          fetch("/api/reports/bids-by-status").then((r) => r.json()),
          fetch("/api/reports/trade-coverage").then((r) => r.json()),
          fetch("/api/reports/response-rates").then((r) => r.json()),
          fetch("/api/reports/follow-up-aging").then((r) => r.json()),
        ]);
        setSummary(s);
        setBidsByStatus(Array.isArray(b) ? b : []);
        setCoverage(Array.isArray(c) ? c : []);
        setRates(Array.isArray(r) ? r : []);
        setAging(Array.isArray(a) ? a : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading)
    return (
      <div className="max-w-6xl mx-auto py-10 px-4">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      </div>
    );

  if (error)
    return (
      <div className="max-w-6xl mx-auto py-10 px-4">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );

  // ---- Section 4: Response rate max for bar scaling ----
  const ratesArray = Array.isArray(rates) ? rates : [];
  const maxExported = Math.max(...ratesArray.map((r) => r.exported), 1);

  // ---- Section 5: aging row color ----
  function agingRowClass(days: number) {
    if (days >= 21) return "bg-red-50";
    if (days >= 14) return "bg-amber-50";
    return "";
  }

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <Link
          href="/reports/post-bid"
          className="text-sm text-blue-600 hover:underline"
        >
          Post-Bid Analytics →
        </Link>
      </div>

      {/* SECTION 1 — Summary Cards */}
      <Section title="Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <SummaryCard label="Active Bids" value={summary?.activeBids ?? 0} />
          <SummaryCard
            label="Trades No Coverage"
            value={summary?.tradesNoCoverage ?? 0}
            warn
          />
          <SummaryCard
            label="Open Questions"
            value={summary?.openQuestions ?? 0}
          />
          <SummaryCard
            label="Unanswered Questions"
            value={summary?.unansweredQuestions ?? 0}
            warn
          />
          <SummaryCard
            label="AI Gap Findings"
            value={summary?.gapFindings ?? 0}
            warn
          />
          <SummaryCard
            label="Exports This Month"
            value={summary?.exportsThisMonth ?? 0}
          />
        </div>
      </Section>

      {/* SECTION 2 — Bids By Status */}
      <Section title="Bids by Status">
        {bidsByStatus.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No bid data.</p>
        ) : (
          <div className="rounded-md border border-zinc-200 p-4 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={bidsByStatus}
                margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
              >
                <XAxis
                  dataKey="status"
                  tickFormatter={(s: string) => STATUS_LABELS[s] ?? s}
                  tick={{ fontSize: 11 }}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip
                  formatter={(value) => [value, "Bids"]}
                  labelFormatter={(s) =>
                    STATUS_LABELS[String(s)] ?? String(s)
                  }
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {bidsByStatus.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={STATUS_COLORS[entry.status] ?? "#a1a1aa"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* SECTION 3 — Trade Coverage */}
      <Section title="Trade Coverage — Active Bids">
        {coverage.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No active bids with trades.</p>
        ) : (
          <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                  <th className="px-4 py-2.5">Bid</th>
                  <th className="px-4 py-2.5">Due Date</th>
                  <th className="px-4 py-2.5">Trade</th>
                  <th className="px-4 py-2.5 text-right">Subs Selected</th>
                  <th className="px-4 py-2.5">Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {coverage.map((row) => (
                  <tr
                    key={`${row.bidId}-${row.tradeId}`}
                    className={row.subCount === 0 ? "bg-red-50" : ""}
                  >
                    <td className="px-4 py-2.5 font-medium">{row.bidName}</td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">
                      {row.dueDate
                        ? new Date(row.dueDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-300">{row.tradeName}</td>
                    <td className="px-4 py-2.5 text-right">{row.subCount}</td>
                    <td className="px-4 py-2.5">
                      {row.subCount > 0 ? (
                        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                          Covered
                        </span>
                      ) : (
                        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          Uncovered
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* SECTION 4 — Response Rate By Trade */}
      <Section title="Response Rate by Trade">
        {ratesArray.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No outreach data yet.</p>
        ) : (
          <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                  <th className="px-4 py-2.5">Trade</th>
                  <th className="px-4 py-2.5 text-right">Exported</th>
                  <th className="px-4 py-2.5 text-right">Responded</th>
                  <th className="px-4 py-2.5 text-right">Rate</th>
                  <th className="px-4 py-2.5 w-40">Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {ratesArray.map((row) => (
                  <tr key={row.tradeName}>
                    <td className="px-4 py-2.5">{row.tradeName}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 dark:text-zinc-400">
                      {row.exported}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 dark:text-zinc-400">
                      {row.responded}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {row.rate}%
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="w-full bg-zinc-100 rounded-full h-2 dark:bg-zinc-800">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{
                            width: `${Math.min(
                              100,
                              (row.exported / maxExported) * 100
                            )}%`,
                            opacity: row.rate > 0 ? 1 : 0.3,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* SECTION 5 — Follow-Up Aging */}
      <Section title="Follow-Up Aging">
        {aging.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No overdue outreach.</p>
        ) : (
          <>
            <div className="flex gap-4 text-xs text-zinc-500 mb-3 dark:text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-200" />
                14+ days
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-200" />
                21+ days
              </span>
            </div>
            <div className="rounded-md border border-zinc-200 overflow-hidden dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                    <th className="px-4 py-2.5">Company</th>
                    <th className="px-4 py-2.5">Trade</th>
                    <th className="px-4 py-2.5">Bid</th>
                    <th className="px-4 py-2.5">Last Activity</th>
                    <th className="px-4 py-2.5 text-right">Days Since</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {aging.map((row) => (
                    <tr key={row.id} className={agingRowClass(row.daysSince)}>
                      <td className="px-4 py-2.5 font-medium">{row.company}</td>
                      <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{row.tradeName}</td>
                      <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{row.bidName}</td>
                      <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">
                        {new Date(row.lastActivity).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {row.daysSince}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs capitalize text-zinc-600 dark:text-zinc-300">
                          {row.status.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
