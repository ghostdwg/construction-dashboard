// tests/fixtures/r2-lifecycle/responsePackageSimulator.ts
//
// FIXTURE_SIMULATED — an in-memory, deterministic model of the FROZEN Build 3
// contract (docs/r2/BUILD3-RESPONSE-CONTROL-LOOP-CONTRACT.md @ 1ce99dd on
// gwx/r2-build3-contract-freeze, read via `git show`, never merged).
//
// None of ResponsePackage/CompiledResponse/Transmittal/OriginatorDisposition/
// ResponsePackageClosureRecord exist as Prisma models on this branch — the
// trade-response package schema lives only on the (untouched)
// gwx-sol-r2-ledger-integration worktree. This module is NOT a
// reimplementation of production behavior and must never be imported by
// application code. It exists solely so the certification harness can
// exercise the frozen contract's transition rules, idempotency rules, and
// append-only-history rules deterministically, without a database, without
// the SOL integration branch, and without waiting for Build 3 implementation.
//
// Every guard below cites the contract section it simulates. Contract
// section numbers refer to BUILD3-RESPONSE-CONTROL-LOOP-CONTRACT.md.

import { createHash } from "node:crypto";
import type { OriginatorDispositionValue } from "./vocabulary-aliases";

export class PackageTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageTransitionError";
  }
}
export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceError";
  }
}
export class AuditWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditWriteError";
  }
}

export type PackageStatus =
  | "DRAFT"
  | "ISSUED"
  | "RESPONSES_IN"
  | "GC_REVIEW"
  | "READY_TO_TRANSMIT"
  | "TRANSMITTED"
  | "REVISE_AND_RESUBMIT"
  | "ACCEPTED"
  | "CLOSED"
  | "REOPENED"
  | "VOIDED";

export type HoldState = "DISPUTED" | "BLOCKED" | null;

export interface SimPackageItem {
  trackedItemId: number;
  bidId: number;
  responseText: string | null;
  gcReviewState: "PENDING" | "ACCEPTED_FOR_TRANSMITTAL" | "RETURNED_FOR_REVISION";
}

export interface SimResponsePackage {
  id: number;
  bidId: number;
  packageNumber: number;
  status: PackageStatus;
  reviewCycle: number;
  holdState: HoldState;
  holdReason: string | null;
  tokenActive: boolean;
  items: SimPackageItem[];
  closedAt: Date | null;
  closedBy: string | null;
}

export interface SimCompiledResponse {
  id: number;
  packageId: number;
  bidId: number;
  revisionIndex: number;
  reviewCycle: number;
  manifestHash: string;
  compiledBy: string;
  compiledAt: Date;
}

export interface SimTransmittal {
  id: number;
  packageId: number;
  bidId: number;
  compiledResponseId: number;
  transmittalNumber: number;
  recipientName: string;
  method: "EMAIL" | "PORTAL" | "PROCORE" | "HAND" | "OTHER";
  sentBy: string;
  sentAt: Date;
  resend: boolean;
}

export interface SimOriginatorDisposition {
  id: number;
  bidId: number;
  transmittalId: number;
  packageItemId: number | null;
  disposition: OriginatorDispositionValue;
  dispositionText: string | null;
  disposedByName: string;
  recordedBy: string;
  recordedAt: Date;
  correctionOfId: number | null;
}

export interface SimClosureRecord {
  id: number;
  packageId: number;
  bidId: number;
  action: "CLOSED" | "REOPENED";
  reason: string | null;
  evidence: Array<{ kind: string; id: number }>;
  itemStatusSnapshot: Array<{ trackedItemId: number; status: string }>;
  actor: string;
  createdAt: Date;
}

export interface SimAuditEntry {
  id: number;
  action: string;
  packageId: number;
  bidId: number;
  payload: Record<string, unknown>;
  recordedAt: Date;
}

const DISPOSITIONS_REQUIRING_TEXT: ReadonlySet<OriginatorDispositionValue> = new Set([
  "ACCEPTED_WITH_COMMENTS",
  "REVISE_AND_RESUBMIT",
  "REJECTED",
  "FIELD_VERIFICATION_REQUIRED",
]);

/** Contract §4.3: transitions the generic status route/actions must reject. */
const PROHIBITED_TARGETS_FROM_TRANSMITTED_OR_LATER: ReadonlySet<PackageStatus> = new Set([
  "VOIDED",
]);

export interface SimulatorOptions {
  /** Injectable clock for deterministic timestamps (defaults to a fixed instant so
   *  fixture output is byte-identical across reruns). */
  clock?: () => Date;
  /** Injectable audit sink. Contract §11: "audit failure rolls the mutation back."
   *  Called synchronously BEFORE any state mutation is committed — if it throws,
   *  the calling method must leave every simulator collection unchanged. Scenario
   *  14 injects a throwing writer to prove this. */
  auditWriter?: (entry: Omit<SimAuditEntry, "id" | "recordedAt">) => void;
}

/**
 * In-memory simulation of the frozen Build 3 response control loop.
 * One instance = one certification run's worth of state; nothing persists
 * across instances, nothing touches disk or network.
 */
export class ResponsePackageSimulator {
  private clock: () => Date;
  private auditWriter?: (entry: Omit<SimAuditEntry, "id" | "recordedAt">) => void;

  private packages = new Map<number, SimResponsePackage>();
  private compiledResponses: SimCompiledResponse[] = [];
  private transmittals: SimTransmittal[] = [];
  private dispositions: SimOriginatorDisposition[] = [];
  private closureRecords: SimClosureRecord[] = [];
  private auditLog: SimAuditEntry[] = [];

  /** trackedItemId -> packageId, for cross-package duplicate-link rejection
   *  (contract §4.3 "package-item membership changes outside DRAFT"; scenario
   *  10 extends this to "an item already live in package A cannot join B"). */
  private itemMembership = new Map<number, number>();

  private nextPackageId = 1;
  private nextCompiledId = 1;
  private nextTransmittalId = 1;
  private nextDispositionId = 1;
  private nextClosureId = 1;
  private nextAuditId = 1;
  private packageNumberByBid = new Map<number, number>();
  private transmittalNumberByBid = new Map<number, number>();

  constructor(options: SimulatorOptions = {}) {
    this.clock = options.clock ?? (() => new Date("2024-11-01T00:00:00.000Z"));
    this.auditWriter = options.auditWriter;
  }

  private assertActorBidMatches(actorBidId: number, targetBidId: number, action: string): void {
    if (actorBidId !== targetBidId) {
      throw new AuthorizationError(
        `${action}: actor scoped to bid ${actorBidId} cannot act on bid ${targetBidId} (404-equivalent, contract §12/§13)`
      );
    }
  }

  /** Fail-closed audit write. Throws BEFORE the caller commits state if the
   *  injected writer throws — callers must invoke this as the LAST step
   *  before mutating collections, exactly mirroring "AuditEvent written
   *  inside the mutation's transaction" (contract §11). */
  private writeAudit(action: string, packageId: number, bidId: number, payload: Record<string, unknown>): SimAuditEntry {
    if (this.auditWriter) {
      // Deliberately not try/caught — a throw here must propagate to the
      // caller's guard clause, which must not have mutated anything yet.
      this.auditWriter({ action, packageId, bidId, payload });
    }
    const entry: SimAuditEntry = {
      id: this.nextAuditId++,
      action,
      packageId,
      bidId,
      payload,
      recordedAt: this.clock(),
    };
    this.auditLog.push(entry);
    return entry;
  }

  getPackage(packageId: number): SimResponsePackage | undefined {
    return this.packages.get(packageId);
  }
  getAuditLog(): readonly SimAuditEntry[] {
    return this.auditLog;
  }
  getClosureRecords(packageId: number): SimClosureRecord[] {
    return this.closureRecords.filter((c) => c.packageId === packageId);
  }
  getTransmittals(packageId: number): SimTransmittal[] {
    return this.transmittals.filter((t) => t.packageId === packageId);
  }
  getDispositions(transmittalId: number): SimOriginatorDisposition[] {
    return this.dispositions.filter((d) => d.transmittalId === transmittalId);
  }
  getCompiledResponses(packageId: number): SimCompiledResponse[] {
    return this.compiledResponses.filter((c) => c.packageId === packageId);
  }

  // ── Package creation and membership (contract §1, §4.3) ───────────────────

  createPackage(bidId: number, actorBidId: number): SimResponsePackage {
    this.assertActorBidMatches(actorBidId, bidId, "createPackage");
    const packageNumber = (this.packageNumberByBid.get(bidId) ?? 0) + 1;
    this.packageNumberByBid.set(bidId, packageNumber);
    const pkg: SimResponsePackage = {
      id: this.nextPackageId++,
      bidId,
      packageNumber,
      status: "DRAFT",
      reviewCycle: 0,
      holdState: null,
      holdReason: null,
      tokenActive: false,
      items: [],
      closedAt: null,
      closedBy: null,
    };
    this.packages.set(pkg.id, pkg);
    return pkg;
  }

  /** Contract §4.3: "Package-item membership changes outside DRAFT" is
   *  prohibited. Also enforces: an item already live in another non-VOIDED
   *  package cannot be double-linked (scenario 10), and an item from a
   *  different bid than the package cannot be added (scenario 7). Both
   *  guards run and throw BEFORE `pkg.items` is touched. */
  addItem(packageId: number, item: { trackedItemId: number; bidId: number }, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "addItem");
    if (item.bidId !== pkg.bidId) {
      throw new ProvenanceError(
        `Cross-bid provenance rejected: TrackedItem ${item.trackedItemId} belongs to bid ${item.bidId}, package ${packageId} belongs to bid ${pkg.bidId}`
      );
    }
    if (pkg.status !== "DRAFT") {
      throw new PackageTransitionError(`addItem rejected: package ${packageId} is ${pkg.status}, membership is frozen outside DRAFT`);
    }
    const existingPackageId = this.itemMembership.get(item.trackedItemId);
    if (existingPackageId !== undefined && existingPackageId !== packageId) {
      const existingPkg = this.packages.get(existingPackageId);
      if (existingPkg && existingPkg.status !== "VOIDED") {
        throw new ProvenanceError(
          `Duplicate response-package linking rejected: TrackedItem ${item.trackedItemId} is already live in package ${existingPackageId} (status ${existingPkg.status})`
        );
      }
    }
    this.writeAudit("package_item_add", packageId, pkg.bidId, { trackedItemId: item.trackedItemId });
    pkg.items.push({ trackedItemId: item.trackedItemId, bidId: item.bidId, responseText: null, gcReviewState: "PENDING" });
    this.itemMembership.set(item.trackedItemId, packageId);
  }

  // ── Build 2 lane (unchanged by Build 3; simulated only as far as the loop needs) ──

  issue(packageId: number, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "issue");
    this.requireStatus(pkg, ["DRAFT"], "issue");
    this.requireNoHold(pkg, "issue");
    if (pkg.items.length === 0) {
      throw new PackageTransitionError("issue rejected: package has no items");
    }
    this.writeAudit("package_issue", packageId, pkg.bidId, { itemCount: pkg.items.length });
    pkg.status = "ISSUED";
    pkg.tokenActive = true;
  }

  recordContractorResponse(packageId: number, trackedItemId: number, responseText: string, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "recordContractorResponse");
    this.requireStatus(pkg, ["ISSUED", "RESPONSES_IN"], "recordContractorResponse");
    const item = pkg.items.find((i) => i.trackedItemId === trackedItemId);
    if (!item) throw new PackageTransitionError(`recordContractorResponse: item ${trackedItemId} not in package ${packageId}`);
    this.writeAudit("package_response_record", packageId, pkg.bidId, { trackedItemId });
    item.responseText = responseText;
    if (pkg.status === "ISSUED" && pkg.items.every((i) => i.responseText !== null)) {
      pkg.status = "RESPONSES_IN";
    }
  }

  submitForGcReview(packageId: number, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "submitForGcReview");
    this.requireStatus(pkg, ["RESPONSES_IN"], "submitForGcReview");
    this.writeAudit("package_gc_review_start", packageId, pkg.bidId, {});
    pkg.status = "GC_REVIEW";
  }

  recordGcReviewDecision(
    packageId: number,
    trackedItemId: number,
    decision: "ACCEPTED_FOR_TRANSMITTAL" | "RETURNED_FOR_REVISION",
    actorBidId: number
  ): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "recordGcReviewDecision");
    this.requireStatus(pkg, ["GC_REVIEW"], "recordGcReviewDecision");
    const item = pkg.items.find((i) => i.trackedItemId === trackedItemId);
    if (!item) throw new PackageTransitionError(`recordGcReviewDecision: item ${trackedItemId} not in package ${packageId}`);
    this.writeAudit("package_gc_review_decision", packageId, pkg.bidId, { trackedItemId, decision });
    item.gcReviewState = decision;
  }

  /** Contract §4.2 row 5: every item's LATEST decision must be
   *  ACCEPTED_FOR_TRANSMITTAL. */
  moveToReadyToTransmit(packageId: number, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "moveToReadyToTransmit");
    this.requireStatus(pkg, ["GC_REVIEW"], "moveToReadyToTransmit");
    if (!pkg.items.every((i) => i.gcReviewState === "ACCEPTED_FOR_TRANSMITTAL")) {
      throw new PackageTransitionError("moveToReadyToTransmit rejected: not every item is ACCEPTED_FOR_TRANSMITTAL");
    }
    this.writeAudit("package_ready_to_transmit", packageId, pkg.bidId, {});
    pkg.status = "READY_TO_TRANSMIT";
  }

  /** Contract §4.2 row 6: backward correction, reason required. */
  backToGcReview(packageId: number, reason: string, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "backToGcReview");
    this.requireStatus(pkg, ["READY_TO_TRANSMIT"], "backToGcReview");
    if (!reason.trim()) throw new PackageTransitionError("backToGcReview requires a reason");
    this.writeAudit("package_back_to_gc_review", packageId, pkg.bidId, { reason });
    pkg.status = "GC_REVIEW";
  }

  // ── Build 3: compile (contract §17 idempotency, §18.1 shape) ─────────────

  private buildManifest(pkg: SimResponsePackage): { hash: string; ids: number[] } {
    const ids = pkg.items.map((i) => i.trackedItemId).sort((a, b) => a - b);
    const raw = JSON.stringify({
      ids,
      reviewCycle: pkg.reviewCycle,
      responses: pkg.items.map((i) => ({ id: i.trackedItemId, text: i.responseText })),
    });
    return { hash: createHash("sha256").update(raw).digest("hex"), ids };
  }

  /** Idempotent: identical manifest returns the existing revision with no
   *  new row (contract §17, acceptance test A1). */
  compile(packageId: number, compiledBy: string, actorBidId: number): { compiled: SimCompiledResponse; reused: boolean } {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "compile");
    this.requireStatus(pkg, ["READY_TO_TRANSMIT", "TRANSMITTED"], "compile");
    this.requireNoHold(pkg, "compile");
    const manifest = this.buildManifest(pkg);
    const existing = this.compiledResponses
      .filter((c) => c.packageId === packageId)
      .sort((a, b) => b.revisionIndex - a.revisionIndex)[0];
    if (existing && existing.manifestHash === manifest.hash) {
      return { compiled: existing, reused: true };
    }
    const revisionIndex = existing ? existing.revisionIndex + 1 : 0;
    this.writeAudit("package_compile", packageId, pkg.bidId, { revisionIndex, reviewCycle: pkg.reviewCycle });
    const compiled: SimCompiledResponse = {
      id: this.nextCompiledId++,
      packageId,
      bidId: pkg.bidId,
      revisionIndex,
      reviewCycle: pkg.reviewCycle,
      manifestHash: manifest.hash,
      compiledBy,
      compiledAt: this.clock(),
    };
    this.compiledResponses.push(compiled);
    return { compiled, reused: false };
  }

  // ── Build 3: transmit (contract §4.2 rows 7-8, §17 single-winner) ────────

  transmit(
    packageId: number,
    input: { recipientName: string; method: SimTransmittal["method"]; sentBy: string; resend?: boolean },
    actorBidId: number
  ): SimTransmittal {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "transmit");
    this.requireNoHold(pkg, "transmit");
    const isResend = input.resend === true;
    if (isResend) {
      this.requireStatus(pkg, ["TRANSMITTED"], "transmit(resend)");
    } else {
      this.requireStatus(pkg, ["READY_TO_TRANSMIT"], "transmit");
    }
    const latestCompiled = this.compiledResponses
      .filter((c) => c.packageId === packageId && c.reviewCycle === pkg.reviewCycle)
      .sort((a, b) => b.revisionIndex - a.revisionIndex)[0];
    if (!latestCompiled) {
      throw new PackageTransitionError("transmit rejected: no compiled revision exists for the current review cycle");
    }
    const transmittalNumber = (this.transmittalNumberByBid.get(pkg.bidId) ?? 0) + 1;
    this.transmittalNumberByBid.set(pkg.bidId, transmittalNumber);
    this.writeAudit("package_transmit", packageId, pkg.bidId, { transmittalNumber, resend: isResend });
    const transmittal: SimTransmittal = {
      id: this.nextTransmittalId++,
      packageId,
      bidId: pkg.bidId,
      compiledResponseId: latestCompiled.id,
      transmittalNumber,
      recipientName: input.recipientName,
      method: input.method,
      sentBy: input.sentBy,
      sentAt: this.clock(),
      resend: isResend,
    };
    this.transmittals.push(transmittal);
    pkg.tokenActive = false; // contract §4.2 row 7 / §20 item 4: transmit revokes all tokens
    if (!isResend) pkg.status = "TRANSMITTED";
    return transmittal;
  }

  // ── Build 3: originator disposition (contract §9, §4.2 rows 9-11) ────────

  recordDisposition(
    transmittalId: number,
    input: {
      disposition: OriginatorDispositionValue;
      dispositionText?: string | null;
      disposedByName: string;
      recordedBy: string;
      packageItemId?: number | null;
      correctionOfId?: number | null;
    },
    actorBidId: number
  ): SimOriginatorDisposition {
    const transmittal = this.transmittals.find((t) => t.id === transmittalId);
    if (!transmittal) throw new PackageTransitionError(`recordDisposition: transmittal ${transmittalId} not found`);
    const pkg = this.mustGetPackage(transmittal.packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "recordDisposition");
    this.requireNoHold(pkg, "recordDisposition");

    const latestTransmittal = this.getTransmittals(pkg.id).sort((a, b) => b.transmittalNumber - a.transmittalNumber)[0];
    if (latestTransmittal.id !== transmittalId) {
      throw new PackageTransitionError("recordDisposition rejected: dispositions may only be recorded against the LATEST transmittal (contract §9.1)");
    }
    if (!["TRANSMITTED", "ACCEPTED", "REVISE_AND_RESUBMIT"].includes(pkg.status)) {
      throw new PackageTransitionError(`recordDisposition rejected: package status ${pkg.status} is not a valid disposition-recording state`);
    }
    if (DISPOSITIONS_REQUIRING_TEXT.has(input.disposition) && !input.dispositionText?.trim()) {
      throw new PackageTransitionError(`recordDisposition rejected: disposition ${input.disposition} requires dispositionText (contract §9.1)`);
    }

    this.writeAudit("package_disposition_record", pkg.id, pkg.bidId, {
      disposition: input.disposition,
      packageItemId: input.packageItemId ?? null,
    });

    const record: SimOriginatorDisposition = {
      id: this.nextDispositionId++,
      bidId: pkg.bidId,
      transmittalId,
      packageItemId: input.packageItemId ?? null,
      disposition: input.disposition,
      dispositionText: input.dispositionText ?? null,
      disposedByName: input.disposedByName,
      recordedBy: input.recordedBy,
      recordedAt: this.clock(),
      correctionOfId: input.correctionOfId ?? null,
    };
    this.dispositions.push(record);

    // Package-level (packageItemId null) drives the status transition
    // (rows 9-11); item-level detail rows never transition (contract §9.1).
    if (record.packageItemId === null) {
      if (record.disposition === "ACCEPTED" || record.disposition === "ACCEPTED_WITH_COMMENTS") {
        pkg.status = "ACCEPTED";
      } else if (
        record.disposition === "REVISE_AND_RESUBMIT" ||
        record.disposition === "REJECTED" ||
        record.disposition === "FIELD_VERIFICATION_REQUIRED"
      ) {
        pkg.status = "REVISE_AND_RESUBMIT";
      }
      // INFORMATIONAL never transitions (contract §3.4).
    }
    return record;
  }

  // ── Build 3: revise-and-resubmit reopen-cycle (contract §9.3, §4.2 rows 12-13, 16-17) ──

  reopenCycle(packageId: number, target: "RESPONSES_IN" | "GC_REVIEW", reason: string, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "reopenCycle");
    this.requireStatus(pkg, ["REVISE_AND_RESUBMIT", "REOPENED"], "reopenCycle");
    if (!reason.trim()) throw new PackageTransitionError("reopenCycle requires a reason");
    this.writeAudit("package_reopen_cycle", packageId, pkg.bidId, { target, reviewCycle: pkg.reviewCycle + 1 });
    pkg.reviewCycle += 1;
    pkg.status = target;
    if (target === "RESPONSES_IN") {
      // Contract §9.3: transmit revoked all tokens; reopening the
      // contractor lane requires fresh issuance, never silent reuse.
      pkg.tokenActive = true;
    }
  }

  // ── Build 3: closure and reopening (contract §10) ─────────────────────────

  /** Contract §10.1 eligibility, checked in one place, all-or-nothing. */
  close(
    packageId: number,
    input: { evidence?: Array<{ kind: string; id: number }>; actor: string; itemStatuses: Array<{ trackedItemId: number; status: string }> },
    actorBidId: number
  ): SimClosureRecord {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "close");
    this.requireStatus(pkg, ["ACCEPTED", "REOPENED"], "close");
    this.requireNoHold(pkg, "close");
    const latestTransmittal = this.getTransmittals(pkg.id).sort((a, b) => b.transmittalNumber - a.transmittalNumber)[0];
    if (!latestTransmittal) throw new PackageTransitionError("close rejected: no transmittal exists");
    const currentDisposition = this.getDispositions(latestTransmittal.id)
      .filter((d) => d.packageItemId === null)
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];
    if (!currentDisposition || !["ACCEPTED", "ACCEPTED_WITH_COMMENTS"].includes(currentDisposition.disposition)) {
      throw new PackageTransitionError(
        "close rejected: current package-level disposition on the latest transmittal is not ACCEPTED-class (contract §10.1 gate 2)"
      );
    }
    this.writeAudit("package_close", packageId, pkg.bidId, { evidence: input.evidence ?? [] });
    const record: SimClosureRecord = {
      id: this.nextClosureId++,
      packageId,
      bidId: pkg.bidId,
      action: "CLOSED",
      reason: null,
      evidence: input.evidence ?? [],
      itemStatusSnapshot: input.itemStatuses,
      actor: input.actor,
      createdAt: this.clock(),
    };
    this.closureRecords.push(record);
    pkg.status = "CLOSED";
    pkg.closedAt = record.createdAt;
    pkg.closedBy = input.actor;
    // Contract §10.1: closure snapshots item status; it NEVER transitions
    // TrackedItem.status. This simulator has no write path to do so at all.
    return record;
  }

  reopen(packageId: number, reason: string, actor: string, actorBidId: number): SimClosureRecord {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "reopen");
    this.requireStatus(pkg, ["CLOSED"], "reopen");
    if (!reason.trim()) throw new PackageTransitionError("reopen requires a reason");
    this.writeAudit("package_reopen", packageId, pkg.bidId, { reason });
    const record: SimClosureRecord = {
      id: this.nextClosureId++,
      packageId,
      bidId: pkg.bidId,
      action: "REOPENED",
      reason,
      evidence: [],
      itemStatusSnapshot: [],
      actor,
      createdAt: this.clock(),
    };
    this.closureRecords.push(record);
    pkg.status = "REOPENED";
    // Contract §10.2: closedAt/closedBy projections clear; history remains
    // (the CLOSED closure record above is never mutated or removed).
    pkg.closedAt = null;
    pkg.closedBy = null;
    return record;
  }

  // ── Holds (contract §3.3) ──────────────────────────────────────────────────

  setHold(packageId: number, holdState: Exclude<HoldState, null>, reason: string, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "setHold");
    if (!reason.trim()) throw new PackageTransitionError("setHold requires a reason");
    this.writeAudit("package_hold_set", packageId, pkg.bidId, { holdState, reason });
    pkg.holdState = holdState;
    pkg.holdReason = reason;
  }

  clearHold(packageId: number, reason: string, actorBidId: number): void {
    const pkg = this.mustGetPackage(packageId);
    this.assertActorBidMatches(actorBidId, pkg.bidId, "clearHold");
    if (!reason.trim()) throw new PackageTransitionError("clearHold requires a reason");
    this.writeAudit("package_hold_clear", packageId, pkg.bidId, { reason });
    pkg.holdState = null;
    pkg.holdReason = null;
  }

  // ── Guards ──────────────────────────────────────────────────────────────

  private mustGetPackage(packageId: number): SimResponsePackage {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new PackageTransitionError(`Package ${packageId} not found`);
    return pkg;
  }

  private requireStatus(pkg: SimResponsePackage, allowed: PackageStatus[], action: string): void {
    if (!allowed.includes(pkg.status)) {
      throw new PackageTransitionError(
        `${action} rejected: package ${pkg.id} is ${pkg.status}, expected one of [${allowed.join(", ")}] (contract §4.2/§4.3)`
      );
    }
    if (PROHIBITED_TARGETS_FROM_TRANSMITTED_OR_LATER.has(pkg.status)) {
      throw new PackageTransitionError(`${action} rejected: package ${pkg.id} is VOIDED (terminal, contract §4.3)`);
    }
  }

  private requireNoHold(pkg: SimResponsePackage, action: string): void {
    if (pkg.holdState !== null) {
      throw new PackageTransitionError(`${action} rejected: package ${pkg.id} is on hold (${pkg.holdState}, contract §3.3)`);
    }
  }
}
