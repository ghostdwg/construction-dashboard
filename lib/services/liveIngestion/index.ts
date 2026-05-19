// Phase MI-5 — public API for live-ingestion integration.

export {
  processNewMarketLead,
  processNewMarketSignal,
  processNewRelationshipEdge,
} from "./processSignal";

export { emitIngestionAudit } from "./audit";

export {
  INGESTION_VERSION,
  type IngestionSourceKind,
  type IngestionProcessOptions,
  type IngestionAuditEntry,
  type IngestionResult,
} from "./types";

/**
 * Fire-and-forget convenience wrapper. Caller awaits ingestion creation
 * but DOES NOT await the emergence-processing tail. Used in API routes
 * where latency matters and the processing can complete asynchronously.
 *
 * Errors are logged to stdout but never propagate — failed processing
 * leaves the source row untouched; a future re-run via the MI-6 PR2
 * backfill catches it idempotently.
 */
export function fireAndForgetIngest<T>(
  promise: Promise<T>,
  label: string
): void {
  promise.catch((err) => {
    console.error(`[live-ingestion] ${label} failed (fire-and-forget):`, err);
  });
}
