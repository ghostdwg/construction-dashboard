"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, AlertTriangle, CheckSquare, MessageSquare } from "lucide-react";

type RiskFlag = { flag: string; severity: string };
type Decision = { category: string; decision: string };

export type DailyBriefCardProps = {
  bidId: number;
  riskFlags: RiskFlag[];
  openActionItems: number;
  decisions: Decision[];
};

const SEV_COLOR: Record<string, string> = {
  critical: "var(--color-danger)",
  moderate: "var(--color-warning)",
  low:      "var(--color-text-dim)",
};

const SEV_BG: Record<string, string> = {
  critical: "rgba(239,68,68,0.08)",
  moderate: "rgba(245,158,11,0.08)",
  low:      "transparent",
};

export default function DailyBriefCard({
  bidId,
  riskFlags,
  openActionItems,
  decisions,
}: DailyBriefCardProps) {
  const [open, setOpen] = useState(false);

  const criticalFlags = riskFlags.filter((f) => f.severity === "critical");
  const hasContent    = riskFlags.length > 0 || openActionItems > 0 || decisions.length > 0;

  if (!hasContent) return null;

  const accentColor = criticalFlags.length > 0 ? "var(--color-danger)" : "var(--color-accent)";

  const summaryParts: string[] = [];
  if (criticalFlags.length > 0)
    summaryParts.push(`${criticalFlags.length} critical flag${criticalFlags.length !== 1 ? "s" : ""}`);
  if (openActionItems > 0)
    summaryParts.push(`${openActionItems} action item${openActionItems !== 1 ? "s" : ""}`);
  if (decisions.length > 0)
    summaryParts.push(`${decisions.length} decision${decisions.length !== 1 ? "s" : ""}`);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      {/* ── Toggle header ──────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 24px",
          background: "transparent",
          border: "none",
          borderLeft: `3px solid ${accentColor}`,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-text-dim)",
            flexShrink: 0,
          }}
        >
          Daily Brief
        </span>

        <span
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summaryParts.join(" · ")}
        </span>

        {open
          ? <ChevronUp  size={14} style={{ flexShrink: 0, color: "var(--color-text-dim)" }} />
          : <ChevronDown size={14} style={{ flexShrink: 0, color: "var(--color-text-dim)" }} />
        }
      </button>

      {/* ── Expanded body ──────────────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            padding: "4px 24px 18px 27px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Risk flags ───────────────────────────────────────────────────── */}
          {riskFlags.length > 0 && (
            <section>
              <SectionLabel>Risk Flags</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {riskFlags.slice(0, 3).map((f, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      minHeight: 48,
                      padding: "11px 14px",
                      background: SEV_BG[f.severity] ?? "var(--color-bg-elevated)",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <AlertTriangle
                      size={15}
                      style={{ flexShrink: 0, marginTop: 2, color: SEV_COLOR[f.severity] ?? "var(--color-text-dim)" }}
                    />
                    <span
                      style={{
                        fontSize: 14,
                        lineHeight: 1.45,
                        color: "var(--color-text-primary)",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {f.flag}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: SEV_COLOR[f.severity] ?? "var(--color-text-dim)",
                        flexShrink: 0,
                        marginTop: 3,
                      }}
                    >
                      {f.severity}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Action items ─────────────────────────────────────────────────── */}
          {openActionItems > 0 && (
            <section>
              <SectionLabel>Action Items</SectionLabel>
              <Link
                href={`/bids/${bidId}?tab=tasks`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 52,
                  padding: "14px 16px",
                  background: "var(--color-bg-elevated)",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  textDecoration: "none",
                  color: "var(--color-text-primary)",
                }}
              >
                <CheckSquare size={16} style={{ flexShrink: 0, color: "var(--color-accent)" }} />
                <span style={{ fontSize: 14, flex: 1 }}>
                  {openActionItems} open action item{openActionItems !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: 13, color: "var(--color-text-dim)" }}>View →</span>
              </Link>
            </section>
          )}

          {/* Recent decisions ─────────────────────────────────────────────── */}
          {decisions.length > 0 && (
            <section>
              <SectionLabel>Recent Decisions</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {decisions.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      minHeight: 48,
                      padding: "11px 14px",
                      background: "var(--color-bg-elevated)",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <MessageSquare
                      size={14}
                      style={{ flexShrink: 0, marginTop: 3, color: "var(--color-text-dim)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--color-text-dim)",
                          marginBottom: 3,
                        }}
                      >
                        {d.category}
                      </span>
                      <p
                        style={{
                          fontSize: 14,
                          color: "var(--color-text-primary)",
                          lineHeight: 1.4,
                          margin: 0,
                        }}
                      >
                        {d.decision}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <Link
                href={`/bids/${bidId}?tab=decisions`}
                style={{
                  display: "inline-block",
                  marginTop: 8,
                  fontSize: 12,
                  color: "var(--color-text-dim)",
                  fontFamily: "var(--font-mono)",
                  textDecoration: "none",
                }}
              >
                View decision log →
              </Link>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "var(--color-text-dim)",
        marginBottom: 8,
      }}
    >
      {children}
    </p>
  );
}
