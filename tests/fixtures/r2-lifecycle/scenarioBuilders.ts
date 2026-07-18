// tests/fixtures/r2-lifecycle/scenarioBuilders.ts
//
// One builder function per required certification scenario (see
// docs/r2/LOCAL-CERTIFICATION-HARNESS.md "Required scenarios", numbered 1-26
// to match the harness mission's list verbatim). Each builder composes:
//   - existing field-response-certification fixtures/builders where the
//     capability is IMPLEMENTED (reused, never duplicated — see
//     tests/field-response-certification/unit-integration-builders.ts);
//   - the FIXTURE_SIMULATED Build 3 engine (responsePackageSimulator.ts) for
//     everything from trade grouping -> response package onward, since none
//     of that schema exists on this branch;
//   - meetingRegisterFixtures.ts for the Meeting/Register leg, which is
//     IMPLEMENTED production code (lib/services/trackedItems/index.ts).
//
// Scenarios that exercise real service code (8, 9) return fixture DATA only
// — the vi.mock wiring lives in the certification test file per repo
// convention (vi.hoisted must be called from the test file's own module
// scope, see tests/certification/r2-lifecycle/*.test.ts).

import {
  makeTrackedItem,
  makeDisposition,
  groupByTrade,
  assignDisplayNumbers,
  FIXTURE_TRADES,
  buildReviseAndResubmitScenario,
  buildAcceptedClosureScenario,
  resetIds,
  type FixtureTrackedItem,
} from "@/tests/field-response-certification/unit-integration-builders";
import {
  makeMeeting,
  makeMeetingActionItem,
  resetMeetingIds,
} from "./meetingRegisterFixtures";
import {
  ResponsePackageSimulator,
  AuthorizationError,
  PackageTransitionError,
  ProvenanceError,
} from "./responsePackageSimulator";

const HOME_BID = 9;
const FOREIGN_BID = 12;
const FIXED_CLOCK = () => new Date("2024-11-01T00:00:00.000Z");

/** Every builder resets both id counters first so a fresh call sequence is
 *  byte-identical across runs (contract-independent determinism guarantee
 *  the harness itself must uphold — see scenario 20). */
function resetAllCounters(): void {
  resetIds(1000);
  resetMeetingIds(5000);
}

function newSim(auditWriter?: (e: { action: string; packageId: number; bidId: number; payload: Record<string, unknown> }) => void) {
  return new ResponsePackageSimulator({ clock: FIXED_CLOCK, auditWriter });
}

/** Drives a package from DRAFT through READY_TO_TRANSMIT with one item and
 *  one accepted GC review decision — the shared happy-path prefix every
 *  disposition-outcome scenario starts from. */
function driveToReadyToTransmit(sim: ResponsePackageSimulator, bidId: number, item: FixtureTrackedItem) {
  const pkg = sim.createPackage(bidId, bidId);
  sim.addItem(pkg.id, { trackedItemId: item.id, bidId }, bidId);
  sim.issue(pkg.id, bidId);
  sim.recordContractorResponse(pkg.id, item.id, item.formalResponse ?? "Synthetic contractor response.", bidId);
  sim.submitForGcReview(pkg.id, bidId);
  sim.recordGcReviewDecision(pkg.id, item.id, "ACCEPTED_FOR_TRANSMITTAL", bidId);
  sim.moveToReadyToTransmit(pkg.id, bidId);
  return pkg;
}

function compileAndTransmit(sim: ResponsePackageSimulator, bidId: number, packageId: number) {
  sim.compile(packageId, "gc.pm@example.test", bidId);
  return sim.transmit(
    packageId,
    { recipientName: "Meridian Architecture Partners", method: "EMAIL", sentBy: "gc.pm@example.test" },
    bidId
  );
}

// ── 1. Standard accepted response ───────────────────────────────────────────

export function buildStandardAcceptedResponseScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Weld repair complete per detail SK-S-014." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const disposition = sim.recordDisposition(
    transmittal.id,
    { disposition: "ACCEPTED", disposedByName: "bob@example.test", recordedBy: "gc.pm@example.test" },
    HOME_BID
  );
  return { sim, pkg, transmittal, disposition, item };
}

// ── 2. Accepted with comments ────────────────────────────────────────────────

export function buildAcceptedWithCommentsScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Re-screwed drywall per Section 09 21 16." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const disposition = sim.recordDisposition(
    transmittal.id,
    {
      disposition: "ACCEPTED_WITH_COMMENTS",
      dispositionText: "Accepted; please photograph the corridor 2B area at next site visit for the record.",
      disposedByName: "alice@example.test",
      recordedBy: "gc.pm@example.test",
    },
    HOME_BID
  );
  return { sim, pkg, transmittal, disposition, item };
}

// ── 3. Revise and resubmit ───────────────────────────────────────────────────

export function buildReviseAndResubmitLifecycleScenario() {
  resetAllCounters();
  const legacy = buildReviseAndResubmitScenario(); // reused Build 2 fixture (anchor bolt)
  const sim = newSim();
  const pkg = driveToReadyToTransmit(sim, HOME_BID, legacy.trackedItem);
  const firstTransmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  sim.recordDisposition(
    firstTransmittal.id,
    {
      disposition: "REVISE_AND_RESUBMIT",
      dispositionText: "Awaiting EOR written confirmation on RFI-041-R2 closure.",
      disposedByName: "alice@example.test",
      recordedBy: "gc.pm@example.test",
    },
    HOME_BID
  );
  sim.reopenCycle(pkg.id, "RESPONSES_IN", "EOR confirmation letter received; contractor to resubmit final report.", HOME_BID);
  sim.recordContractorResponse(pkg.id, legacy.trackedItem.id, legacy.revisionResponse.formalResponse, HOME_BID);
  sim.submitForGcReview(pkg.id, HOME_BID);
  sim.recordGcReviewDecision(pkg.id, legacy.trackedItem.id, "ACCEPTED_FOR_TRANSMITTAL", HOME_BID);
  sim.moveToReadyToTransmit(pkg.id, HOME_BID);
  const secondTransmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const finalDisposition = sim.recordDisposition(
    secondTransmittal.id,
    { disposition: "ACCEPTED", disposedByName: "alice@example.test", recordedBy: "gc.pm@example.test" },
    HOME_BID
  );
  return { sim, pkg, legacy, firstTransmittal, secondTransmittal, finalDisposition };
}

// ── 4. Rejected response ─────────────────────────────────────────────────────

export function buildRejectedResponseScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Proposed remediation: epoxy injection." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const disposition = sim.recordDisposition(
    transmittal.id,
    {
      disposition: "REJECTED",
      dispositionText: "Epoxy injection does not meet structural repair spec Section 03 01 30; resubmit per EOR detail.",
      disposedByName: "bob@example.test",
      recordedBy: "gc.pm@example.test",
    },
    HOME_BID
  );
  return { sim, pkg, transmittal, disposition, item };
}

// ── 5. Field verification required ──────────────────────────────────────────

export function buildFieldVerificationRequiredScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Fire damper installed per revised detail." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const disposition = sim.recordDisposition(
    transmittal.id,
    {
      disposition: "FIELD_VERIFICATION_REQUIRED",
      dispositionText: "Third-party inspector must verify damper rating on site before acceptance.",
      disposedByName: "alice@example.test",
      recordedBy: "gc.pm@example.test",
    },
    HOME_BID
  );
  // GC-only rework lane — no contractor input needed, per contract §9.3.
  sim.reopenCycle(pkg.id, "GC_REVIEW", "Attaching third-party inspection evidence directly.", HOME_BID);
  return { sim, pkg, transmittal, disposition, item };
}

// ── 6. Informational disposition ────────────────────────────────────────────

export function buildInformationalDispositionScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Temporary hoist removal complete." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const statusBefore = pkg.status;
  const disposition = sim.recordDisposition(
    transmittal.id,
    { disposition: "INFORMATIONAL", disposedByName: "bob@example.test", recordedBy: "gc.pm@example.test" },
    HOME_BID
  );
  return { sim, pkg, transmittal, disposition, statusBefore, statusAfter: pkg.status };
}

// ── 7. Cross-bid provenance rejection ───────────────────────────────────────

export function buildCrossBidProvenanceRejectionScenario() {
  resetAllCounters();
  const sim = newSim();
  const pkg = sim.createPackage(HOME_BID, HOME_BID);
  const foreignItem = makeTrackedItem({ bidId: FOREIGN_BID });
  let caught: unknown = null;
  try {
    sim.addItem(pkg.id, { trackedItemId: foreignItem.id, bidId: FOREIGN_BID }, HOME_BID);
  } catch (err) {
    caught = err;
  }
  return { sim, pkg, foreignItem, caught, isProvenanceError: caught instanceof ProvenanceError };
}

// ── 8. Cross-meeting provenance rejection (fixture data; real-service test) ─

export function buildCrossMeetingProvenanceRejectionFixtures() {
  resetAllCounters();
  const homeMeeting = makeMeeting({ bidId: HOME_BID });
  const foreignMeeting = makeMeeting({ bidId: FOREIGN_BID });
  const foreignActionItem = makeMeetingActionItem({ bidId: FOREIGN_BID, meetingId: foreignMeeting.id });
  return { homeMeeting, foreignMeeting, foreignActionItem };
}

// ── 9. Duplicate Register promotion rejection (fixture data; real-service test) ─

export function buildDuplicateRegisterPromotionRejectionFixtures() {
  resetAllCounters();
  const meeting = makeMeeting({ bidId: HOME_BID });
  const actionItem = makeMeetingActionItem({ bidId: HOME_BID, meetingId: meeting.id });
  return { meeting, actionItem };
}

// ── 10. Duplicate response-package linking rejection ────────────────────────

export function buildDuplicateResponsePackageLinkingRejectionScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID });
  const packageA = sim.createPackage(HOME_BID, HOME_BID);
  sim.addItem(packageA.id, { trackedItemId: item.id, bidId: HOME_BID }, HOME_BID);
  const packageB = sim.createPackage(HOME_BID, HOME_BID);
  let caught: unknown = null;
  try {
    sim.addItem(packageB.id, { trackedItemId: item.id, bidId: HOME_BID }, HOME_BID);
  } catch (err) {
    caught = err;
  }
  return { sim, packageA, packageB, item, caught, isProvenanceError: caught instanceof ProvenanceError };
}

// ── 11-13. Rerun preservation ────────────────────────────────────────────────

export function buildRerunPreservationOfPromotedRecordsScenario() {
  const first = buildStandardAcceptedResponseScenario();
  const second = buildStandardAcceptedResponseScenario();
  return {
    firstItemId: first.item.id,
    secondItemId: second.item.id,
    firstPackageId: first.pkg.id,
    secondPackageId: second.pkg.id,
    idsMatch: first.item.id === second.item.id && first.pkg.id === second.pkg.id,
  };
}

export function buildRerunPreservationOfHumanEditedRecordsScenario() {
  const scenario = buildStandardAcceptedResponseScenario();
  const humanEditedResponse = "HUMAN EDIT: superseding the synthetic response with a corrected field note.";
  const item = { ...scenario.item, formalResponse: humanEditedResponse };
  // A rerun of the SAME builder produces a fresh synthetic object — it must
  // never claim to have "preserved" the human edit made to a prior run's
  // returned object, because this harness has no persistence layer across
  // runs (in-memory only, contract-required — see docs section F). The
  // invariant under test is narrower and real: the builder's return value is
  // a plain object a caller can freely mutate without the builder's OWN
  // internal state (id counters, `scenario.item`) being affected.
  const rerun = buildStandardAcceptedResponseScenario();
  return {
    humanEditedResponse,
    editedItemUnaffectedOriginal: scenario.item.formalResponse !== humanEditedResponse,
    rerunUnaffectedByEdit: rerun.item.formalResponse !== humanEditedResponse,
    item,
  };
}

export function buildRerunPreservationOfDispositionedRecordsScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Temporary hoist removal complete." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  // INFORMATIONAL never transitions the package (contract §3.4), so status
  // stays TRANSMITTED — where compile() remains a legal action (contract
  // §12) — letting this scenario prove recompile-after-disposition
  // idempotency without first advancing to a state that forbids compiling.
  const disposition = sim.recordDisposition(
    transmittal.id,
    { disposition: "INFORMATIONAL", disposedByName: "bob@example.test", recordedBy: "gc.pm@example.test" },
    HOME_BID
  );
  const dispositionCountBefore = sim.getDispositions(transmittal.id).length;
  // Re-compiling after disposition with an IDENTICAL manifest must reuse the
  // existing compiled revision (contract §17) rather than mint a new one —
  // this is the concrete "rerun creates no duplicate/duplicate-adjacent row"
  // guarantee for the dispositioned state.
  const recompiled = sim.compile(pkg.id, "gc.pm@example.test", HOME_BID);
  const dispositionCountAfter = sim.getDispositions(transmittal.id).length;
  return {
    sim,
    pkg,
    transmittal,
    disposition,
    dispositionCountBefore,
    dispositionCountAfter,
    recompileReused: recompiled.reused,
  };
}

// ── 14. Audit/history write failure ──────────────────────────────────────────

export function buildAuditWriteFailureScenario() {
  resetAllCounters();
  // Only the `issue` mutation's audit write fails (a realistic transient
  // outage, not a globally broken sink) — this isolates the assertion to
  // "the failing write's OWN mutation rolls back" rather than requiring
  // every preceding setup call to already tolerate a broken audit sink.
  const failingWriter = (entry: { action: string }) => {
    if (entry.action === "package_issue") {
      throw new Error("simulated audit sink outage");
    }
  };
  const sim = newSim(failingWriter);
  const bidId = HOME_BID;
  let caught: unknown = null;
  const pkg = sim.createPackage(bidId, bidId); // createPackage doesn't audit-write; succeeds
  const item = makeTrackedItem({ bidId });
  sim.addItem(pkg.id, { trackedItemId: item.id, bidId }, bidId); // addItem's audit-write also succeeds (writer only fails on the call below)
  try {
    sim.issue(pkg.id, bidId); // issue() DOES audit-write — must fail closed
  } catch (err) {
    caught = err;
  }
  return { sim, pkg, caught, statusUnchanged: pkg.status === "DRAFT" };
}

// ── 15-18. Closure gating ─────────────────────────────────────────────────────

export function buildClosureDeniedUnresolvedResponsesScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID });
  const pkg = sim.createPackage(HOME_BID, HOME_BID);
  sim.addItem(pkg.id, { trackedItemId: item.id, bidId: HOME_BID }, HOME_BID);
  sim.issue(pkg.id, HOME_BID); // still ISSUED — no contractor response recorded yet
  let caught: unknown = null;
  try {
    sim.close(pkg.id, { actor: "gc.pm@example.test", itemStatuses: [] }, HOME_BID);
  } catch (err) {
    caught = err;
  }
  return { sim, pkg, caught, isTransitionError: caught instanceof PackageTransitionError };
}

export function buildClosureDeniedBeforeOriginatorDispositionScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Response pending originator review." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  compileAndTransmit(sim, HOME_BID, pkg.id); // TRANSMITTED — no disposition recorded at all
  let caught: unknown = null;
  try {
    sim.close(pkg.id, { actor: "gc.pm@example.test", itemStatuses: [] }, HOME_BID);
  } catch (err) {
    caught = err;
  }
  return { sim, pkg, caught, isTransitionError: caught instanceof PackageTransitionError };
}

export function buildClosureDeniedWhileDisputedOrBlockedScenario() {
  const scenario = buildStandardAcceptedResponseScenario(); // reaches ACCEPTED, disposition-eligible
  scenario.sim.setHold(scenario.pkg.id, "DISPUTED", "Responsibility disputed between two trades.", HOME_BID);
  let caught: unknown = null;
  try {
    scenario.sim.close(scenario.pkg.id, { actor: "gc.pm@example.test", itemStatuses: [] }, HOME_BID);
  } catch (err) {
    caught = err;
  }
  return { ...scenario, caught, isTransitionError: caught instanceof PackageTransitionError };
}

export function buildClosureAllowedAfterEveryGateScenario() {
  const scenario = buildStandardAcceptedResponseScenario();
  const closureRecord = scenario.sim.close(
    scenario.pkg.id,
    {
      actor: "gc.pm@example.test",
      evidence: [{ kind: "transmittal", id: scenario.transmittal.id }, { kind: "disposition", id: scenario.disposition.id }],
      itemStatuses: [{ trackedItemId: scenario.item.id, status: "CLOSED" }],
    },
    HOME_BID
  );
  return { ...scenario, closureRecord };
}

// ── 19. Reopened item retains prior immutable closure history ──────────────

export function buildReopenedRetainsPriorClosureHistoryScenario() {
  const closed = buildClosureAllowedAfterEveryGateScenario();
  const originalClosureRecord = { ...closed.closureRecord };
  const reopenRecord = closed.sim.reopen(closed.pkg.id, "Originator requested one additional as-built photo.", "gc.pm@example.test", HOME_BID);
  const historyAfterReopen = closed.sim.getClosureRecords(closed.pkg.id);
  return { ...closed, originalClosureRecord, reopenRecord, historyAfterReopen };
}

// ── 20. Deterministic rerun creates no duplicate lifecycle rows ────────────

export function buildDeterministicRerunNoDuplicateRowsScenario() {
  const first = buildStandardAcceptedResponseScenario();
  const second = buildStandardAcceptedResponseScenario();
  const firstSnapshot = {
    item: first.item,
    transmittal: first.transmittal,
    disposition: first.disposition,
    auditLog: first.sim.getAuditLog(),
  };
  const secondSnapshot = {
    item: second.item,
    transmittal: second.transmittal,
    disposition: second.disposition,
    auditLog: second.sim.getAuditLog(),
  };
  return { firstSnapshot, secondSnapshot };
}

// ── 21. Trade grouping remains deterministic ────────────────────────────────

export function buildTradeGroupingDeterminismScenario() {
  resetAllCounters();
  const items = [
    makeTrackedItem({ bidId: HOME_BID, tradeId: 9 }),
    makeTrackedItem({ bidId: HOME_BID, tradeId: 1 }),
    makeTrackedItem({ bidId: HOME_BID, tradeId: null }),
    makeTrackedItem({ bidId: HOME_BID, tradeId: 7 }),
  ];
  const firstPass = groupByTrade(items);
  const shuffled = [items[2], items[0], items[3], items[1]];
  const secondPass = groupByTrade(shuffled);
  return { items, firstPass, secondPass, tradeNamesFirst: firstPass.map((g) => g.tradeName), tradeNamesSecond: secondPass.map((g) => g.tradeName) };
}

// ── 22. Response numbering remains deterministic ────────────────────────────

export function buildResponseNumberingDeterminismScenario() {
  resetAllCounters();
  const scenario = buildStandardAcceptedResponseScenario();
  // assignDisplayNumbers operates on observations; reused here against a
  // synthetic observation set ordered the same way response items would be.
  const obsLike = [
    { id: 3, createdAt: new Date("2024-10-15T10:02:00.000Z") },
    { id: 1, createdAt: new Date("2024-10-15T10:00:00.000Z") },
    { id: 2, createdAt: new Date("2024-10-15T10:01:00.000Z") },
  ] as unknown as Parameters<typeof assignDisplayNumbers>[0];
  const firstPass = assignDisplayNumbers(obsLike).map((o) => o.displayNumber);
  const secondPass = assignDisplayNumbers([...obsLike].reverse()).map((o) => o.displayNumber);
  return { scenario, firstPass, secondPass };
}

// ── 23. Source provenance traceable end-to-end ──────────────────────────────

export function buildProvenanceTraceabilityScenario() {
  resetAllCounters();
  const meeting = makeMeeting({ bidId: HOME_BID });
  const actionItem = makeMeetingActionItem({ bidId: HOME_BID, meetingId: meeting.id });
  // sourceMeetingActionItemId mirrors what promoteMeetingActionItem() writes.
  // FixtureTrackedItem (unit-integration-builders.ts) predates the Meeting
  // leg and has no sourceMeetingId/sourceMeetingActionItemId fields; extend
  // it here via intersection rather than editing the reused builder file.
  const trackedItem: FixtureTrackedItem & { sourceMeetingId: number; sourceMeetingActionItemId: number } = {
    ...makeTrackedItem({
      bidId: HOME_BID,
      sourceKind: "meeting",
      evidenceExcerpt: actionItem.sourceText,
    }),
    sourceMeetingId: meeting.id,
    sourceMeetingActionItemId: actionItem.id,
  };
  const sim = newSim();
  const pkg = driveToReadyToTransmit(sim, HOME_BID, trackedItem);
  const transmittal = compileAndTransmit(sim, HOME_BID, pkg.id);
  const disposition = sim.recordDisposition(
    transmittal.id,
    { disposition: "ACCEPTED", disposedByName: "bob@example.test", recordedBy: "gc.pm@example.test" },
    HOME_BID
  );
  const closureRecord = sim.close(
    pkg.id,
    { actor: "gc.pm@example.test", evidence: [{ kind: "transmittal", id: transmittal.id }], itemStatuses: [{ trackedItemId: trackedItem.id, status: "CLOSED" }] },
    HOME_BID
  );
  return { meeting, actionItem, trackedItem, sim, pkg, transmittal, disposition, closureRecord };
}

// ── 24. Superseded response revisions remain historically available ────────

export function buildSupersededResponseRevisionsScenario() {
  resetAllCounters();
  const sim = newSim();
  const item = makeTrackedItem({ bidId: HOME_BID, formalResponse: "Initial contractor response." });
  const pkg = driveToReadyToTransmit(sim, HOME_BID, item);
  const first = sim.compile(pkg.id, "gc.pm@example.test", HOME_BID);
  const firstTransmittal = sim.transmit(
    pkg.id,
    { recipientName: "Meridian Architecture Partners", method: "EMAIL", sentBy: "gc.pm@example.test" },
    HOME_BID
  );
  // A revise-and-resubmit cycle is the only contract-legal way to change a
  // contractor response after the first compile (compile is only legal from
  // READY_TO_TRANSMIT/TRANSMITTED, contract §12; response edits are only
  // legal from ISSUED/RESPONSES_IN) — this produces a genuinely different
  // manifest for the second compile without inventing an off-contract path.
  sim.recordDisposition(
    firstTransmittal.id,
    { disposition: "REVISE_AND_RESUBMIT", dispositionText: "Please add as-built photos before final acceptance.", disposedByName: "alice@example.test", recordedBy: "gc.pm@example.test" },
    HOME_BID
  );
  sim.reopenCycle(pkg.id, "RESPONSES_IN", "Contractor to attach as-built photo documentation.", HOME_BID);
  sim.recordContractorResponse(pkg.id, item.id, "Revised contractor response with as-built photo documentation attached.", HOME_BID);
  sim.submitForGcReview(pkg.id, HOME_BID);
  sim.recordGcReviewDecision(pkg.id, item.id, "ACCEPTED_FOR_TRANSMITTAL", HOME_BID);
  sim.moveToReadyToTransmit(pkg.id, HOME_BID);
  const second = sim.compile(pkg.id, "gc.pm@example.test", HOME_BID);
  const allRevisions = sim.getCompiledResponses(pkg.id);
  return { sim, pkg, first, second, allRevisions };
}

// ── 25. Append-only transmittal/disposition history ─────────────────────────

export function buildAppendOnlyHistoryScenario() {
  const scenario = buildRejectedResponseScenario();
  const secondDisposition = scenario.sim.recordDisposition(
    scenario.transmittal.id,
    { disposition: "INFORMATIONAL", disposedByName: "alice@example.test", recordedBy: "gc.pm@example.test", correctionOfId: scenario.disposition.id },
    HOME_BID
  );
  const allDispositions = scenario.sim.getDispositions(scenario.transmittal.id);
  return { ...scenario, secondDisposition, allDispositions };
}

// ── 26. Unauthorized/cross-bid operations create no partial records ────────

export function buildUnauthorizedCrossBidOperationRejectionScenario() {
  resetAllCounters();
  const sim = newSim();
  let createCaught: unknown = null;
  try {
    sim.createPackage(HOME_BID, FOREIGN_BID); // actor scoped to a different bid than the target
  } catch (err) {
    createCaught = err;
  }
  const legitPkg = sim.createPackage(HOME_BID, HOME_BID);
  let issueCaught: unknown = null;
  try {
    sim.issue(legitPkg.id, FOREIGN_BID);
  } catch (err) {
    issueCaught = err;
  }
  return {
    sim,
    legitPkg,
    createCaught,
    issueCaught,
    createRejected: createCaught instanceof AuthorizationError,
    issueRejected: issueCaught instanceof AuthorizationError,
    statusUnchangedAfterRejectedIssue: legitPkg.status === "DRAFT",
  };
}

export const FIXTURES_REEXPORT = { FIXTURE_TRADES, makeDisposition, buildAcceptedClosureScenario };
