// tests/fixtures/r2-lifecycle/vocabulary-aliases.ts
//
// Packet B3-P0 evaluation (docs/tests only — no production code touched).
//
// The existing Field Response certification fixtures
// (tests/field-response-certification/fixtures/expected-originator-disposition.json,
// expected-gc-review.json) were authored before the Build 3 contract was
// frozen (docs/r2/BUILD3-RESPONSE-CONTROL-LOOP-CONTRACT.md @ 1ce99dd, read via
// `git show` from gwx/r2-build3-contract-freeze — NOT merged into this
// branch). They used placeholder vocabulary borrowed from
// ConsultantDispositionRecord.dispositionType (APPROVE | REJECT | DEFER |
// VOID) and ad-hoc "TR-YYYY-NNN" transmittal-number strings, because no
// OriginatorDisposition/Transmittal model existed yet to author against.
//
// This module records the reconciliation the frozen contract calls for
// (contract §3.4, §7, §20 item 2) so the certification harness's
// FIXTURE_SIMULATED scenarios speak the frozen vocabulary rather than the
// placeholder one. It changes no schema and no production behavior.
//
// IMPORTANT — namespace boundary (contract §19.2): ConsultantDispositionRecord
// (observation-level, Build 1, IMPLEMENTED in this repo) and
// OriginatorDisposition (transmittal-level, Build 3, FUTURE_CONTRACT — no
// schema in this repo) are DISTINCT namespaces that never read or write each
// other. This module never suggests renaming ConsultantDispositionRecord's
// real vocabulary. It only reconciles the CERTIFICATION FIXTURE's use of that
// vocabulary as a stand-in for the not-yet-existing OriginatorDisposition.

// ── Originator disposition vocabulary reconciliation ────────────────────────

/** Frozen contract vocabulary (§3.4). */
export const ORIGINATOR_DISPOSITION_VALUES = [
  "ACCEPTED",
  "ACCEPTED_WITH_COMMENTS",
  "REVISE_AND_RESUBMIT",
  "REJECTED",
  "FIELD_VERIFICATION_REQUIRED",
  "INFORMATIONAL",
] as const;
export type OriginatorDispositionValue = (typeof ORIGINATOR_DISPOSITION_VALUES)[number];

/** Legacy placeholder vocabulary used by the existing certification fixtures
 *  (expected-gc-review.json `dispositionType`, borrowed from
 *  ConsultantDispositionRecord.dispositionType). */
export const LEGACY_FIXTURE_DISPOSITION_VALUES = [
  "APPROVE",
  "REJECT",
  "DEFER",
  "VOID",
] as const;
export type LegacyFixtureDispositionValue = (typeof LEGACY_FIXTURE_DISPOSITION_VALUES)[number];

export type AliasResolution =
  | { kind: "CLEAN_ALIAS"; to: OriginatorDispositionValue; note: string }
  | { kind: "CONFLICT"; note: string };

/**
 * Contract §3.4's parenthetical is explicit about exactly one mapping:
 * "the certification fixtures' `dispositionType: APPROVE` maps to `ACCEPTED`".
 * REJECT is a clean semantic match to REJECTED. DEFER and VOID have NO
 * frozen Build 3 equivalent at the originator/transmittal level — they are
 * recorded as CONFLICTs, not silently mapped, per this harness's mandate to
 * surface conflicts rather than invent contract vocabulary.
 */
export const B3_P0_DISPOSITION_ALIAS_MAP: Record<LegacyFixtureDispositionValue, AliasResolution> = {
  APPROVE: {
    kind: "CLEAN_ALIAS",
    to: "ACCEPTED",
    note: "Contract §3.4 states this mapping explicitly; safe direct alias.",
  },
  REJECT: {
    kind: "CLEAN_ALIAS",
    to: "REJECTED",
    note: "Semantic match (past-tense normalization only); no contract ambiguity.",
  },
  DEFER: {
    kind: "CONFLICT",
    note:
      "No frozen OriginatorDisposition value means 'defer'. Closest candidates are " +
      "REVISE_AND_RESUBMIT (rework requested) or FIELD_VERIFICATION_REQUIRED (evidence " +
      "requested) but the contract does not equate either to the fixture's original " +
      "'decision deferred, pending further review' meaning. Requires an explicit human " +
      "decision at B3-P0 time, not a mechanical mapping. This harness does not resolve it.",
  },
  VOID: {
    kind: "CONFLICT",
    note:
      "VOID is a ResponsePackage-level status (contract §3.1, pre-transmit only) and a " +
      "ConsultantReport-level status — it is not a member of the OriginatorDisposition " +
      "vocabulary at all. A fixture using VOID at the originator-disposition level is " +
      "conflating two different Build 3 concepts. Requires fixture correction, not aliasing.",
  },
};

/** ACCEPTED_WITH_COMMENTS, FIELD_VERIFICATION_REQUIRED, and INFORMATIONAL have
 *  no representation anywhere in the pre-existing fixtures — they are net-new
 *  contract vocabulary this harness must fixture from scratch (see
 *  scenarioBuilders.ts scenarios 2, 5, 6). Recorded here so the gap is
 *  explicit rather than silently absent. */
export const NET_NEW_ORIGINATOR_DISPOSITION_VALUES: OriginatorDispositionValue[] = [
  "ACCEPTED_WITH_COMMENTS",
  "FIELD_VERIFICATION_REQUIRED",
  "INFORMATIONAL",
];

// ── Transmittal number reconciliation ───────────────────────────────────────
//
// Existing fixtures use display strings like "TR-2024-031" (year-scoped,
// not a monotonic per-bid sequence). Contract §7 requires:
//   - `Transmittal.transmittalNumber`: an integer, `@@unique([bidId,
//     transmittalNumber])`, per-bid monotonic (1, 2, 3, ...), allocated
//     inside the transmit transaction — never reused, never year-scoped.
//   - Display format (UI/PDF only, not stored): `TX-{transmittalNumber}`
//     with `Response Rev {CompiledResponse.revisionIndex}`.
//
// The legacy "TR-YYYY-NNN" strings cannot be mechanically converted into a
// monotonic per-bid integer sequence (the year segment carries no ordinal
// meaning and multiple legacy numbers may collide across years). This is a
// CONFLICT, not a clean alias: B3-P0 must decide whether legacy strings are
// discarded (this harness's choice — new fixtures use the frozen integer +
// display-format shape directly, see scenarioBuilders.ts) or retained as a
// separate historical-reference field. This harness does not retrofit the
// legacy strings into a fabricated sequence.

export function formatTransmittalDisplay(transmittalNumber: number, compiledRevisionIndex: number): string {
  return `TX-${transmittalNumber} Response Rev ${compiledRevisionIndex}`;
}

export const LEGACY_TRANSMITTAL_STRING_PATTERN = /^TR-\d{4}-\d{3,}$/;

export interface B3P0Assessment {
  requiredBeforeProductionBuild3: true;
  cleanAliasCount: number;
  conflictCount: number;
  netNewVocabularyCount: number;
}

/** Machine-checkable summary used by the certification suite to assert the
 *  reconciliation surface hasn't silently grown or shrunk since this was
 *  written. B3-P0 (schema-free vocabulary reconciliation) is a prerequisite
 *  for B3-P1 (schema + migration) per the contract's packet dependency graph
 *  (§24: "P0 ∥ P1 → P2 → ..."), so `requiredBeforeProductionBuild3` is always
 *  true — recorded, not computed, because it is a contract fact, not a
 *  derived one. */
export function assessB3P0(): B3P0Assessment {
  const resolutions = Object.values(B3_P0_DISPOSITION_ALIAS_MAP);
  return {
    requiredBeforeProductionBuild3: true,
    cleanAliasCount: resolutions.filter((r) => r.kind === "CLEAN_ALIAS").length,
    conflictCount: resolutions.filter((r) => r.kind === "CONFLICT").length,
    netNewVocabularyCount: NET_NEW_ORIGINATOR_DISPOSITION_VALUES.length,
  };
}
