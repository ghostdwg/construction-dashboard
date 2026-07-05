// Provider Readiness — a truthful, admin-safe status surface (Work Package
// "provider-readiness-truth", extended by "provider-invocation-evidence").
//
// Purpose: let an operator see the ACTUAL state of AI-provider configuration
// without ever making a real provider call and without ever exposing a
// credential value. This module intentionally returns classifications,
// booleans, counts, and timestamps ONLY.
//
// Five things this deliberately keeps separate (never conflated):
//   1. credentialConfigured   — does a value exist at all (DB or env)?
//   2. credentialSource       — which layer supplied it ("database" | "environment" | "missing")
//   3. stubMode                — honest report of what stub-mode toggles actually exist today
//   4. usageEvidence           — has at least one AiUsageLog row ever been written?
//   5. liveProviderVerification — a genuine 5-state classification (see below)
//
// On (3): there is no single, persistent, centrally-toggleable "stub mode"
// setting anywhere in this codebase. What actually exists are three
// independent, feature-scoped environment-variable flags
// (BRIEF_STUB_MODE, GAP_STUB_MODE, ADDENDUM_STUB_MODE), each read directly
// from process.env at call time by its own route/service — none of them are
// DB-backed AppSettings, none go through getSetting(), and none apply
// globally. Separately, lib/services/ai/gateway.ts's `client` parameter is a
// per-call test-injection seam with no persistent state of its own. This
// function reports the three known flags' current values plus a note
// explaining they are not centrally toggleable, rather than inventing a
// fake unified "stub mode" setting.
//
// On (5): this field previously always read "NOT_VERIFIED" because nothing
// in AiUsageLog distinguished a real provider response from a stubbed one —
// the exact same row shape was written either way. That gap is now closed
// (Work Package "provider-invocation-evidence") WITHOUT a Prisma schema
// migration: AiUsageLog.status (previously a two-valued "ok" | "error"
// column, declared but with "error" never actually written) now also
// carries "stub" for stub-mode evidence rows — see lib/services/ai/aiUsageLog.ts's
// module doc for the full write-path contract. This function reads that
// evidence to compute one of five states, ordered from least to most
// specific claim:
//
//   NOT_CONFIGURED       — no credential configured at all. Takes priority
//                          over any evidence, since a call literally cannot
//                          succeed without a credential.
//   CONFIGURED_UNVERIFIED — credential exists, but zero AiUsageLog rows of
//                          ANY kind (real or stub) have ever been written.
//   STUB_ONLY            — evidence exists, but every recorded row is a
//                          stub — no real call has ever been attempted.
//   LAST_REAL_SUCCESS     — the most recent REAL-call evidence row
//                          (status "ok" or "error", i.e. excluding stub
//                          rows) recorded a success.
//   LAST_REAL_FAILURE     — the most recent real-call evidence row recorded
//                          a failure.
//
// This is intentionally the least-overclaiming read of the evidence at every
// branch: a missing credential always wins, and the presence of ANY row
// (even 9,999 of them) can never imply verification unless at least one of
// them is tagged as a genuine real-call outcome.

import { prisma } from "@/lib/prisma";
import { getSettingSource } from "@/lib/services/settings/appSettingsService";

export type CredentialSource = "database" | "environment" | "missing";

export type LiveProviderVerification =
  | "NOT_CONFIGURED"
  | "CONFIGURED_UNVERIFIED"
  | "LAST_REAL_SUCCESS"
  | "LAST_REAL_FAILURE"
  | "STUB_ONLY";

export type ProviderReadiness = {
  /** Does a value exist for ANTHROPIC_API_KEY, from either the DB or env? Never the value itself. */
  credentialConfigured: boolean;
  /** Which layer actually supplied it (or neither). */
  credentialSource: CredentialSource;
  /** Honest report of stub-mode state — see module doc above. */
  stubMode: {
    /** There is no single persistent, admin-toggleable stub-mode setting. */
    centrallyToggleable: false;
    note: string;
    /** Current values of the three known feature-scoped env flags (booleans only). */
    activeFlags: {
      BRIEF_STUB_MODE: boolean;
      GAP_STUB_MODE: boolean;
      ADDENDUM_STUB_MODE: boolean;
    };
  };
  /** Durable evidence that AI calls have been attempted and logged — never provider health. */
  usageEvidence: {
    observed: boolean;
    totalCount: number;
    /** Most recent row's timestamp + model id only — never prompt/document content, never cost, never bidId. */
    mostRecent: { createdAt: string; model: string } | null;
  };
  /**
   * A genuine 5-state classification computed from durable AiUsageLog
   * evidence — see module doc above for the exact precedence rules.
   */
  liveProviderVerification: LiveProviderVerification;
};

const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";

function sourceToClass(source: "db" | "env" | "missing"): CredentialSource {
  if (source === "db") return "database";
  if (source === "env") return "environment";
  return "missing";
}

function readStubFlag(envVar: string): boolean {
  return process.env[envVar] === "true";
}

/**
 * Compute the 5-state liveProviderVerification classification. See module
 * doc for the full precedence rationale. `mostRecentRealRow` must already be
 * scoped to real-call evidence only (status "ok" | "error" — never "stub").
 */
function computeLiveProviderVerification(
  credentialConfigured: boolean,
  totalCount: number,
  mostRecentRealRow: { status: string } | null
): LiveProviderVerification {
  if (!credentialConfigured) return "NOT_CONFIGURED";
  if (mostRecentRealRow) {
    return mostRecentRealRow.status === "error" ? "LAST_REAL_FAILURE" : "LAST_REAL_SUCCESS";
  }
  if (totalCount > 0) return "STUB_ONLY";
  return "CONFIGURED_UNVERIFIED";
}

export async function getProviderReadiness(): Promise<ProviderReadiness> {
  const source = await getSettingSource(ANTHROPIC_KEY);
  const credentialSource = sourceToClass(source);
  const credentialConfigured = credentialSource !== "missing";

  const [totalCount, mostRecentRow, mostRecentRealRow] = await Promise.all([
    prisma.aiUsageLog.count(),
    prisma.aiUsageLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, model: true },
    }),
    // Real-call evidence ONLY — explicitly excludes "stub" rows so a stub
    // completion can never masquerade as LAST_REAL_SUCCESS/LAST_REAL_FAILURE.
    prisma.aiUsageLog.findFirst({
      where: { status: { in: ["ok", "error"] } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    }),
  ]);

  return {
    credentialConfigured,
    credentialSource,
    stubMode: {
      centrallyToggleable: false,
      note:
        "No single persistent stub-mode setting exists in this codebase. " +
        "Three independent, feature-scoped environment flags control stub " +
        "behavior directly via process.env (not via getSetting()/the DB): " +
        "BRIEF_STUB_MODE, GAP_STUB_MODE, ADDENDUM_STUB_MODE. " +
        "lib/services/ai/gateway.ts's `client` parameter is a separate, " +
        "per-call test-injection seam with no persistent state.",
      activeFlags: {
        BRIEF_STUB_MODE: readStubFlag("BRIEF_STUB_MODE"),
        GAP_STUB_MODE: readStubFlag("GAP_STUB_MODE"),
        ADDENDUM_STUB_MODE: readStubFlag("ADDENDUM_STUB_MODE"),
      },
    },
    usageEvidence: {
      observed: totalCount > 0,
      totalCount,
      mostRecent: mostRecentRow
        ? { createdAt: mostRecentRow.createdAt.toISOString(), model: mostRecentRow.model }
        : null,
    },
    liveProviderVerification: computeLiveProviderVerification(
      credentialConfigured,
      totalCount,
      mostRecentRealRow
    ),
  };
}
