// Provider Readiness — a truthful, admin-safe status surface (Work Package
// "provider-readiness-truth").
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
//   5. liveProviderVerification — ALWAYS "NOT_VERIFIED" (see rationale below)
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
// On (5): AiUsageLog rows (and BackgroundJob completion) prove an AI call
// was ATTEMPTED and something was logged — they do NOT prove a real provider
// response was received, because the exact same row shape is written
// whether the call was real or one of the stub-mode code paths above (stub
// responses are logged with the same schema; nothing in AiUsageLog
// distinguishes "real provider" from "stubbed"). No durable, source-backed
// record in this codebase currently proves a successful live provider
// response occurred. Therefore this field always reads "NOT_VERIFIED" today.
// This is a deliberate, honest default — not a placeholder pending removal.

import { prisma } from "@/lib/prisma";
import { getSettingSource } from "@/lib/services/settings/appSettingsService";

export type CredentialSource = "database" | "environment" | "missing";

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
   * Always "NOT_VERIFIED" today: no durable record in this codebase
   * distinguishes a real provider response from a stubbed one. See module
   * doc for rationale.
   */
  liveProviderVerification: "NOT_VERIFIED";
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

export async function getProviderReadiness(): Promise<ProviderReadiness> {
  const source = await getSettingSource(ANTHROPIC_KEY);
  const credentialSource = sourceToClass(source);

  const [totalCount, mostRecentRow] = await Promise.all([
    prisma.aiUsageLog.count(),
    prisma.aiUsageLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, model: true },
    }),
  ]);

  return {
    credentialConfigured: credentialSource !== "missing",
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
    liveProviderVerification: "NOT_VERIFIED",
  };
}
