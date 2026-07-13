// Quick Push orchestrator.
//
// Runs the 7-step sequence: award → create_project → vendors → submittals →
// schedule → budget → confirm. Emits SSE-style events via the provided
// callback so the route can stream them to the client.
//
// All Prisma writes go through the passed-in prisma client so unit tests can
// inject an in-memory fake. Real callers pass the singleton.

import type { PrismaClient } from "@prisma/client";
import { ProcoreError, clearProcoreTokenCache, procoreGet, getCompanyId } from "./client";
import { pushVendors, pushSubmittals, pushBudget } from "./pushService";
import { pushScheduleToProcore } from "./scheduleService";
import { createProcoreProject } from "./projectService";
import {
  emptyStepResults,
  StepName,
  StepResult,
  StepResults,
  SseStepEvent,
  SseCompleteEvent,
  SseFailedEvent,
} from "./quickPushTypes";

export type QuickPushEmit = (
  event: "step" | "complete" | "failed",
  data: SseStepEvent | SseCompleteEvent | SseFailedEvent
) => void;

type ProcoreProjectShape = { id: number; name: string };

function now(): string {
  return new Date().toISOString();
}

export async function runQuickPush(
  bidId: number,
  db: PrismaClient,
  emit: QuickPushEmit
): Promise<void> {
  const stepResults: StepResults = emptyStepResults();
  let procoreProjectId: string | null = null;

  const persistResults = (step: StepName, partial: Partial<StepResult>) => {
    stepResults[step] = { ...stepResults[step], ...partial };
  };

  const startStep = (step: StepName) => {
    const startedAt = now();
    persistResults(step, { state: "running", startedAt });
    emit("step", { step, state: "running" });
  };

  const doneStep = (step: StepName, extra: Partial<SseStepEvent> = {}) => {
    const finishedAt = now();
    persistResults(step, { state: "done", finishedAt, ...extra });
    emit("step", { step, state: "done", ...extra });
  };

  const doneWithErrors = (step: StepName, extra: Partial<SseStepEvent> = {}) => {
    const finishedAt = now();
    persistResults(step, { state: "done_with_errors", finishedAt, ...extra });
    emit("step", { step, state: "done_with_errors", ...extra });
  };

  const skipStep = (step: StepName, detail: string) => {
    persistResults(step, { state: "skipped", detail });
    emit("step", { step, state: "skipped", detail });
  };

  const failStep = (step: StepName, err: unknown): never => {
    const isProcoreError = err instanceof ProcoreError;
    if (isProcoreError && (err as ProcoreError).status === 401) {
      clearProcoreTokenCache();
    }
    const error =
      err instanceof Error ? err.message : `Unknown error at step ${step}`;
    const httpStatus = isProcoreError ? (err as ProcoreError).status : undefined;
    persistResults(step, { state: "failed", error, httpStatus });
    emit("step", { step, state: "failed", error, httpStatus });
    emit("failed", {
      ok: false,
      failedAt: step,
      error,
      stepResults,
    });
    throw new Error("__quick_push_halted__");
  };

  try {
    // ── Step 1: Award ──────────────────────────────────────────────────────────
    startStep("award");
    try {
      const bid = await db.bid.findUnique({
        where: { id: bidId },
        select: { status: true, procoreProjectId: true },
      });
      if (!bid) throw new ProcoreError("Bid not found", 404);

      if (bid.status === "awarded") {
        persistResults("award", { state: "skipped", detail: "Already awarded" });
        emit("step", { step: "award", state: "skipped", detail: "Already awarded" });
      } else {
        await db.bid.update({ where: { id: bidId }, data: { status: "awarded" } });
        doneStep("award", { detail: "Bid marked awarded" });
      }

      procoreProjectId = bid.procoreProjectId;
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("award", err);
    }

    // ── Step 2: Create / link Procore project ──────────────────────────────────
    startStep("create_project");
    try {
      const result = await createProcoreProject(bidId);
      procoreProjectId = result.procoreProjectId;

      if (result.state === "already_linked") {
        persistResults("create_project", {
          state: "skipped",
          procoreProjectId,
          linkedExisting: true,
        });
        emit("step", {
          step: "create_project",
          state: "skipped",
          detail: `Already linked to project ID ${procoreProjectId}`,
          procoreProjectId,
        });
      } else {
        doneStep("create_project", {
          procoreProjectId,
          linkedExisting: result.state === "linked_existing",
          detail:
            result.state === "linked_existing"
              ? `Linked existing Procore project ${procoreProjectId}`
              : `Created new Procore project ${procoreProjectId}`,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("create_project", err);
    }

    if (!procoreProjectId) {
      failStep("create_project", new Error("procoreProjectId not set after create_project step"));
    }

    // ── Step 3: Vendors ────────────────────────────────────────────────────────
    startStep("vendors");
    try {
      const vendorResult = await pushVendors(bidId);
      if (vendorResult.created === 0 && vendorResult.updated === 0 && vendorResult.skipped === 0 && vendorResult.errors.length === 0) {
        skipStep("vendors", "No vendors to push");
      } else if (vendorResult.errors.length > 0) {
        doneWithErrors("vendors", {
          created: vendorResult.created,
          updated: vendorResult.updated,
          skipped: vendorResult.skipped,
          errors: vendorResult.errors,
        });
      } else {
        doneStep("vendors", {
          created: vendorResult.created,
          updated: vendorResult.updated,
          skipped: vendorResult.skipped,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("vendors", err);
    }

    // ── Step 4: Submittals ─────────────────────────────────────────────────────
    startStep("submittals");
    try {
      const submittalCount = await db.submittalItem.count({ where: { bidId } });
      if (submittalCount === 0) {
        skipStep("submittals", "No submittals to push");
      } else {
        const submittalResult = await pushSubmittals(bidId, procoreProjectId!);
        if (submittalResult.errors.length > 0) {
          doneWithErrors("submittals", {
            created: submittalResult.created,
            skipped: submittalResult.skipped,
            errors: submittalResult.errors,
          });
        } else {
          doneStep("submittals", {
            created: submittalResult.created,
            skipped: submittalResult.skipped,
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("submittals", err);
    }

    // ── Step 5: Schedule ───────────────────────────────────────────────────────
    startStep("schedule");
    try {
      const activityCount = await db.scheduleActivity.count({ where: { bidId } });
      if (activityCount === 0) {
        skipStep("schedule", "No schedule activities to push");
      } else {
        const schedResult = await pushScheduleToProcore(bidId, procoreProjectId!);
        doneStep("schedule", {
          importId: schedResult.importId,
          activityCount: schedResult.activityCount,
          procoreStatus: schedResult.status,
          errors: schedResult.procoreErrors.length > 0 ? schedResult.procoreErrors : undefined,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("schedule", err);
    }

    // ── Step 6: Budget ─────────────────────────────────────────────────────────
    startStep("budget");
    try {
      const bid = await db.bid.findUnique({
        where: { id: bidId },
        select: { budgetGcLines: true },
      });
      const hasGcLines = (() => {
        try {
          const parsed = JSON.parse(bid?.budgetGcLines ?? "[]") as unknown[];
          return Array.isArray(parsed) && parsed.length > 0;
        } catch { return false; }
      })();
      const tradeCount = await db.bidTrade.count({ where: { bidId } });
      if (!hasGcLines && tradeCount === 0) {
        skipStep("budget", "No budget lines to push");
      } else {
        const budgetResult = await pushBudget(bidId, procoreProjectId!);
        if (budgetResult.errors.length > 0) {
          doneWithErrors("budget", {
            created: budgetResult.created,
            skipped: budgetResult.skipped,
            errors: budgetResult.errors,
          });
        } else {
          doneStep("budget", {
            created: budgetResult.created,
            skipped: budgetResult.skipped,
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("budget", err);
    }

    // ── Step 7: Confirm ────────────────────────────────────────────────────────
    startStep("confirm");
    try {
      const companyId = await getCompanyId();
      await procoreGet<ProcoreProjectShape>(
        `/rest/v1.0/companies/${companyId}/projects/${procoreProjectId}`
      );
      doneStep("confirm", { detail: `Procore project ${procoreProjectId} verified` });
    } catch (err) {
      if (err instanceof Error && err.message === "__quick_push_halted__") throw err;
      failStep("confirm", err);
    }

    // ── All done ───────────────────────────────────────────────────────────────
    emit("complete", {
      ok: true,
      procoreProjectId,
      stepResults,
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "__quick_push_halted__") {
      emit("failed", {
        ok: false,
        failedAt: "confirm",
        error: err instanceof Error ? err.message : "Unexpected error",
        stepResults,
      });
    }
  }
}
