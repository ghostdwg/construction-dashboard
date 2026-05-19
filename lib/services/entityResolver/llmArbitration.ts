// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/llmArbitration.ts
//  Phase MI-2 — Pass 6 stub (default OFF).
//
//  When two or more Pass-3/4 candidates score within `ambiguityDelta` of each
//  other, the resolver may optionally ask an LLM to disambiguate. MI-2 ships
//  this as a stub that ALWAYS returns null — no LLM call, no cost.
//
//  Activation (future PR):
//    1. Set env RESOLVER_AMBIGUITY_LLM=true
//    2. Replace the stub body with a constrained-prompt call to the Anthropic
//       SDK (already a project dep). Prompt must:
//         a. List candidates + input name
//         b. Force a single ID response from the candidate list (or "NONE")
//         c. Have a hard token cap (single-token answer)
//    3. Add prompt/response audit fields to ResolverAuditEntry
//    4. Add per-source spend cap / circuit breaker
//
//  Philosophy: the resolver's intelligence moat is durable canonical memory.
//  LLMs are optional arbitration tools, never the primary path. If the
//  deterministic passes (1–4) don't decide, Pass 4 falls through to operator
//  review by default — the system errs toward human resolution, not
//  probabilistic guessing.
// ──────────────────────────────────────────────────────────────────────────────

import type { ScoredCandidate } from "./types";

export interface ArbitrationInput {
  inputName: string;
  inputType: string | null;
  candidates: ScoredCandidate[];
}

/**
 * Returns the chosen entity ID, or null if no arbitration was performed
 * (default behavior in MI-2) or the model declined to pick.
 */
export async function runLlmArbitration(
  _input: ArbitrationInput
): Promise<string | null> {
  if (process.env.RESOLVER_AMBIGUITY_LLM !== "true") return null;

  // MI-2 stub: even when the flag is on, the real implementation is deferred.
  // The warning surfaces in logs so an operator can see they enabled a flag
  // that hasn't shipped yet.
  console.warn(
    "[entity-resolver] RESOLVER_AMBIGUITY_LLM=true but Pass 6 implementation " +
      "is a stub in MI-2. No arbitration performed; falling back to Pass 4."
  );
  return null;
}
