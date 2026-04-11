"use client";

// Module H1 — Handoff Packet UI
//
// Renders a preview of the handoff packet on the bid detail page.
// Available for ALL bid statuses — preview mode shows a banner explaining
// the bid hasn't been awarded yet. Awarded mode is the "real" handoff view.
//
// Sections:
//   1. Project Summary card  — intake context, total bid amount
//   2. Trade Awards table    — trade by trade with awarded sub
//   3. Open Items            — RFIs, assumptions, risk flags (count badges)
//   4. Document Inventory    — uploaded docs by type
//
// Action: Download XLSX handoff packet.

import { useEffect, useState } from "react";
import BuyoutTracker from "./BuyoutTracker";

// ── Types (mirror lib/services/handoff/assembleHandoffPacket.ts) ───────────

type HandoffPacket = {
  generatedAt: string;
  bidId: number;
  status: string;
  isAwarded: boolean;
  project: {
    name: string;
    number: string;
    location: string | null;
    dueDate: string | null;
    projectType: string;
    deliveryMethod: string | null;
    ownerType: string | null;
    buildingType: string | null;
    approxSqft: number | null;
    stories: number | null;
    description: string | null;
    ourBidAmount: number | null;
  };
  constraints: {
    occupiedSpace: boolean;
    phasingRequired: boolean;
    siteConstraints: string | null;
    estimatorNotes: string | null;
    scopeBoundaryNotes: string | null;
    veInterest: boolean;
    ldAmountPerDay: number | null;
    ldCapAmount: number | null;
    dbeGoalPercent: number | null;
  };
  trades: Array<{
    tradeId: number;
    tradeName: string;
    csiCode: string | null;
    tier: string;
    awardedSubName: string | null;
    awardedContactName: string | null;
    awardedContactEmail: string | null;
    bidAmount: number | null;
    contractStatus: string;
  }>;
  awardedSubs: Array<{
    subcontractorId: number;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    trades: string[];
    contractStatus: string;
  }>;
  buyoutRollup: {
    tradeCount: number;
    tradesCommitted: number;
    tradesAwarded: number;
    totalCommitted: number;
    totalPaid: number;
    totalRemaining: number;
    totalRetainageHeld: number;
  };
  submittalRollup: {
    total: number;
    byStatus: Record<string, number>;
    overdue: number;
  };
  openItems: {
    unresolvedRfis: Array<{
      id: number;
      rfiNumber: number | null;
      question: string;
      trade: string | null;
      status: string;
      priority: string;
      dueDate: string | null;
    }>;
    unresolvedAssumptions: Array<{
      assumption: string;
      sourceRef: string | null;
      urgency: string;
    }>;
  };
  riskFlags: Array<{
    flag: string;
    severity: string;
    foundIn: string | null;
    potentialImpact: string | null;
    recommendedAction: string | null;
  }>;
  documents: Array<{
    fileName: string;
    type: "spec" | "drawing" | "addendum";
    uploadedAt: string;
    reference: string | null;
  }>;
  complianceStatus: {
    totalItems: number;
    checkedItems: number;
    percentComplete: number;
  } | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

const DELIVERY_LABELS: Record<string, string> = {
  HARD_BID: "Hard Bid",
  DESIGN_BUILD: "Design-Build",
  CM_AT_RISK: "CM at Risk",
  NEGOTIATED: "Negotiated",
};
const OWNER_LABELS: Record<string, string> = {
  PUBLIC_ENTITY: "Public Entity",
  PRIVATE_OWNER: "Private Owner",
  DEVELOPER: "Developer",
  INSTITUTIONAL: "Institutional",
};

// Contract status badge color (H2 — full lifecycle)
const CONTRACT_STATUS_STYLES: Record<string, string> = {
  PENDING:         "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  LOI_SENT:        "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  CONTRACT_SENT:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  CONTRACT_SIGNED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  PO_ISSUED:       "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  ACTIVE:          "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  CLOSED:          "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  LOI_SENT: "LOI Sent",
  CONTRACT_SENT: "Contract Sent",
  CONTRACT_SIGNED: "Contract Signed",
  PO_ISSUED: "PO Issued",
  ACTIVE: "Active",
  CLOSED: "Closed",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  low:      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const DOC_TYPE_STYLES: Record<string, string> = {
  spec:     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  drawing:  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  addendum: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

// ── Component ──────────────────────────────────────────────────────────────

export default function HandoffTab({ bidId }: { bidId: number }) {
  const [packet, setPacket] = useState<HandoffPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [openSection, setOpenSection] = useState<"rfis" | "assumptions" | "risks" | null>(null);
  // Bumped by BuyoutTracker after a save → refetches the packet so the
  // Trade Awards table and downloadable XLSX reflect fresh committed amounts.
  const [packetReloadTick, setPacketReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bids/${bidId}/handoff`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as HandoffPacket;
        if (!cancelled) {
          setPacket(data);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bidId, packetReloadTick]);

  async function downloadPacket() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/handoff/export`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Export failed: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match ? match[1] : "handoff.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading handoff packet…</p>;
  }
  if (error || !packet) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
        {error ?? "Failed to load packet"}
      </div>
    );
  }

  const isAwarded = packet.isAwarded;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header + Action ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Handoff Packet
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
            Compiled from intake, awarded subs, open items, and uploaded documents.
          </p>
        </div>
        <button
          onClick={downloadPacket}
          disabled={downloading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? "Generating…" : isAwarded ? "Download Handoff Packet" : "Download Preview"}
        </button>
      </div>

      {/* ── Preview banner ── */}
      {!isAwarded && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Preview mode.</strong> This bid has not been awarded yet (status:{" "}
          <span className="font-mono">{packet.status}</span>). Once status changes to{" "}
          <span className="font-mono">awarded</span>, this packet becomes the official
          handoff for project execution.
        </div>
      )}

      {/* ── Section 1 — Project Summary ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          Project Summary
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <SummaryRow label="Project Name" value={packet.project.name} />
          <SummaryRow label="Bid Number" value={packet.project.number} />
          <SummaryRow label="Location" value={packet.project.location ?? "—"} />
          <SummaryRow label="Due Date" value={fmtDate(packet.project.dueDate)} />
          <SummaryRow
            label="Project Type"
            value={packet.project.projectType}
          />
          <SummaryRow
            label="Delivery Method"
            value={
              packet.project.deliveryMethod
                ? DELIVERY_LABELS[packet.project.deliveryMethod] ?? packet.project.deliveryMethod
                : "—"
            }
          />
          <SummaryRow
            label="Owner Type"
            value={
              packet.project.ownerType
                ? OWNER_LABELS[packet.project.ownerType] ?? packet.project.ownerType
                : "—"
            }
          />
          <SummaryRow
            label="Building Type"
            value={packet.project.buildingType ?? "—"}
          />
          <SummaryRow
            label="Sqft / Stories"
            value={`${packet.project.approxSqft != null ? packet.project.approxSqft.toLocaleString() : "—"} sf · ${packet.project.stories ?? "—"}`}
          />
          <SummaryRow
            label="Total Bid Amount"
            value={fmtDollar(packet.project.ourBidAmount)}
          />
        </div>

        {/* Constraints subgroup */}
        {(packet.constraints.occupiedSpace ||
          packet.constraints.phasingRequired ||
          packet.constraints.siteConstraints ||
          packet.constraints.scopeBoundaryNotes ||
          packet.constraints.veInterest) && (
          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 dark:text-zinc-400">
              Constraints
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {packet.constraints.occupiedSpace && (
                <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 text-xs font-medium">
                  Occupied Space
                </span>
              )}
              {packet.constraints.phasingRequired && (
                <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 text-xs font-medium">
                  Phasing Required
                </span>
              )}
              {packet.constraints.veInterest && (
                <span className="rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 text-xs font-medium">
                  VE Interest
                </span>
              )}
            </div>
            {packet.constraints.siteConstraints && (
              <p className="text-sm text-zinc-700 dark:text-zinc-200 mb-1">
                <span className="font-medium">Site:</span> {packet.constraints.siteConstraints}
              </p>
            )}
            {packet.constraints.scopeBoundaryNotes && (
              <p className="text-sm text-zinc-700 dark:text-zinc-200">
                <span className="font-medium">Scope boundary:</span>{" "}
                {packet.constraints.scopeBoundaryNotes}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Section 2 — Trade Awards ── */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Trade Awards ({packet.trades.length})
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Committed amounts + contract status sourced from the Buyout Tracker below.
          </p>
        </div>
        {packet.trades.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500 dark:text-zinc-400 italic">
            No trades assigned to this bid.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2.5">Trade</th>
                <th className="px-4 py-2.5">Awarded Sub</th>
                <th className="px-4 py-2.5">Contact</th>
                <th className="px-4 py-2.5 text-right">Committed</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {packet.trades.map((t) => {
                const statusStyle =
                  CONTRACT_STATUS_STYLES[t.contractStatus] ?? CONTRACT_STATUS_STYLES.PENDING;
                const statusLabel =
                  CONTRACT_STATUS_LABELS[t.contractStatus] ?? t.contractStatus;
                return (
                  <tr key={t.tradeId}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-zinc-800 dark:text-zinc-100">
                        {t.tradeName}
                      </div>
                      {t.csiCode && (
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                          {t.csiCode} · T{t.tier.replace("TIER", "")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {t.awardedSubName ? (
                        <span className="text-zinc-800 dark:text-zinc-100">{t.awardedSubName}</span>
                      ) : (
                        <span className="text-zinc-400 italic dark:text-zinc-500">
                          not yet awarded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                      {t.awardedContactName ? (
                        <>
                          <div>{t.awardedContactName}</div>
                          {t.awardedContactEmail && (
                            <div className="text-zinc-400 dark:text-zinc-500">
                              {t.awardedContactEmail}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-800 dark:text-zinc-100">
                      {t.bidAmount != null ? fmtDollar(t.bidAmount) : (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Section 2b — Buyout Tracker (Module H2) ── */}
      <BuyoutTracker
        bidId={bidId}
        onChanged={() => setPacketReloadTick((t) => t + 1)}
      />

      {/* ── Section 2c — Submittal Register summary (Module H3) ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Submittal Register
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Managed on the Submittals tab.
            </p>
          </div>
          <a
            href={`/bids/${bidId}?tab=submittals`}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400 mt-0.5"
          >
            Open Submittals tab →
          </a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SubmittalStat label="Total" value={packet.submittalRollup.total} />
          <SubmittalStat
            label="Pending"
            value={
              (packet.submittalRollup.byStatus.PENDING ?? 0) +
              (packet.submittalRollup.byStatus.REQUESTED ?? 0)
            }
          />
          <SubmittalStat
            label="In Review"
            value={
              (packet.submittalRollup.byStatus.RECEIVED ?? 0) +
              (packet.submittalRollup.byStatus.UNDER_REVIEW ?? 0)
            }
          />
          <SubmittalStat
            label="Approved"
            value={
              (packet.submittalRollup.byStatus.APPROVED ?? 0) +
              (packet.submittalRollup.byStatus.APPROVED_AS_NOTED ?? 0)
            }
          />
          <SubmittalStat
            label="Overdue"
            value={packet.submittalRollup.overdue}
            warn={packet.submittalRollup.overdue > 0}
          />
        </div>
      </section>

      {/* ── Section 3 — Open Items (count badges + expandable) ── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          Open Items
        </h3>
        <div className="flex flex-wrap gap-2 mb-4">
          <CountBadge
            label="Open RFIs"
            count={packet.openItems.unresolvedRfis.length}
            active={openSection === "rfis"}
            onClick={() => setOpenSection(openSection === "rfis" ? null : "rfis")}
          />
          <CountBadge
            label="Unresolved Assumptions"
            count={packet.openItems.unresolvedAssumptions.length}
            active={openSection === "assumptions"}
            onClick={() => setOpenSection(openSection === "assumptions" ? null : "assumptions")}
          />
          <CountBadge
            label="Risk Flags"
            count={packet.riskFlags.length}
            active={openSection === "risks"}
            onClick={() => setOpenSection(openSection === "risks" ? null : "risks")}
          />
        </div>

        {openSection === "rfis" && (
          <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {packet.openItems.unresolvedRfis.length === 0 ? (
              <p className="text-sm text-zinc-500 italic dark:text-zinc-400">No open RFIs.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {packet.openItems.unresolvedRfis.map((rfi) => (
                  <li
                    key={rfi.id}
                    className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      {rfi.rfiNumber != null && (
                        <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">
                          RFI-{String(rfi.rfiNumber).padStart(3, "0")}
                        </span>
                      )}
                      {rfi.trade && (
                        <span className="text-zinc-500 dark:text-zinc-400">{rfi.trade}</span>
                      )}
                      <span className="text-zinc-400 dark:text-zinc-500">·</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{rfi.status}</span>
                      {rfi.priority === "CRITICAL" && (
                        <span className="rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                          critical
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-700 mt-1 dark:text-zinc-200">{rfi.question}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {openSection === "assumptions" && (
          <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {packet.openItems.unresolvedAssumptions.length === 0 ? (
              <p className="text-sm text-zinc-500 italic dark:text-zinc-400">
                No unresolved assumptions. (Generate the brief to populate this list.)
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {packet.openItems.unresolvedAssumptions.map((a, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
                  >
                    <p className="text-sm text-zinc-700 dark:text-zinc-200">{a.assumption}</p>
                    <p className="text-xs text-zinc-500 mt-1 dark:text-zinc-400">
                      {a.urgency.replace(/_/g, " ")}
                      {a.sourceRef && (
                        <>
                          {" · "}
                          <span className="font-mono">{a.sourceRef}</span>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {openSection === "risks" && (
          <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {packet.riskFlags.length === 0 ? (
              <p className="text-sm text-zinc-500 italic dark:text-zinc-400">
                No risk flags identified. (Generate the brief to populate this list.)
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {packet.riskFlags.map((r, i) => {
                  const sevStyle = SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.moderate;
                  return (
                    <li
                      key={i}
                      className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${sevStyle}`}
                        >
                          {r.severity}
                        </span>
                        {r.foundIn && (
                          <span className="text-xs text-zinc-500 font-mono dark:text-zinc-400">
                            {r.foundIn}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-700 dark:text-zinc-200">{r.flag}</p>
                      {r.recommendedAction && (
                        <p className="text-xs text-zinc-500 mt-1 italic dark:text-zinc-400">
                          → {r.recommendedAction}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── Section 4 — Document Inventory ── */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Document Inventory ({packet.documents.length})
          </h3>
        </div>
        {packet.documents.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500 italic dark:text-zinc-400">
            No documents uploaded yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">File Name</th>
                <th className="px-4 py-2.5">Reference</th>
                <th className="px-4 py-2.5">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {packet.documents.map((doc, i) => {
                const typeStyle = DOC_TYPE_STYLES[doc.type] ?? DOC_TYPE_STYLES.spec;
                return (
                  <tr key={i}>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${typeStyle}`}
                      >
                        {doc.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-800 dark:text-zinc-100">
                      {doc.fileName}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {doc.reference ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {fmtDate(doc.uploadedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className="text-sm text-zinc-800 dark:text-zinc-100">{value}</p>
    </div>
  );
}

function SubmittalStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  const color = warn
    ? "text-red-600 dark:text-red-400"
    : "text-zinc-900 dark:text-zinc-100";
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className={`text-lg font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function CountBadge({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const baseStyle =
    count === 0
      ? "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60";
  const activeRing = active ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900" : "";
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${baseStyle} ${activeRing}`}
    >
      <span className="font-semibold">{count}</span>
      {" · "}
      {label}
    </button>
  );
}
