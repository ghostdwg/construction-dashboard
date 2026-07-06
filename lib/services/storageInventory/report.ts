// Aggregate inventory report — the DEFAULT, always-safe mode. Structurally
// incapable of writing anything: this file never imports or calls
// adapter.updateField, never imports Prisma's update/create/delete shapes,
// and never surfaces a raw path, filename, or record value — only counts and
// classification labels, grouped by model.

import { classifyInventoryRow } from "@/lib/services/storageInventory/classify";
import {
  INVENTORY_ONLY_MODELS,
  TRANSFORMABLE_MODELS,
  type AggregateModelBucket,
  type InventoryReport,
  type ModelName,
  type StorageInventoryDbAdapter,
} from "@/lib/services/storageInventory/types";

const ALL_MODELS: ModelName[] = [...TRANSFORMABLE_MODELS, ...INVENTORY_ONLY_MODELS];

function emptyBucket(): AggregateModelBucket {
  return {
    total: 0,
    canonical: 0,
    legacyCwd: 0,
    legacyStorageRoot: 0,
    legacyStorageRootConvertible: 0,
    invalid: 0,
    null: 0,
  };
}

/**
 * Build the full aggregate inventory report by reading (never writing) every
 * row of every one of the 6 model/field pairs via the adapter, classifying
 * each with the appropriate EXISTING classify function, and tallying counts.
 * No `adapter.updateField` call appears anywhere in this function or
 * anything it calls — read-only, cannot mutate.
 */
export async function buildInventoryReport(
  adapter: StorageInventoryDbAdapter,
  generatedAt: string
): Promise<InventoryReport> {
  const models = {} as Record<ModelName, AggregateModelBucket>;

  for (const model of ALL_MODELS) {
    const bucket = emptyBucket();
    const rows = await adapter.findRows(model);
    for (const row of rows) {
      const classification = classifyInventoryRow(model, row);
      bucket.total += 1;
      switch (classification.bucket) {
        case "canonical":
          bucket.canonical += 1;
          break;
        case "legacy-cwd":
          bucket.legacyCwd += 1;
          break;
        case "legacy-storage-root":
          bucket.legacyStorageRoot += 1;
          if (classification.convertible) bucket.legacyStorageRootConvertible += 1;
          break;
        case "invalid":
          bucket.invalid += 1;
          break;
        case "null":
          bucket.null += 1;
          break;
      }
    }
    models[model] = bucket;
  }

  return { generatedAt, models };
}

/** Human-readable, safe (counts-only) rendering of an inventory report for CLI stdout. */
export function formatReport(report: InventoryReport): string {
  const lines: string[] = [];
  lines.push(`[storage-inventory] report generated at ${report.generatedAt}`);
  lines.push("");
  for (const model of [...TRANSFORMABLE_MODELS, ...INVENTORY_ONLY_MODELS]) {
    const b = report.models[model];
    const kind = (TRANSFORMABLE_MODELS as ModelName[]).includes(model) ? "transformable" : "inventory-only";
    lines.push(`  ${model} (${kind}) — total=${b.total}`);
    lines.push(`    canonical=${b.canonical}`);
    lines.push(`    legacy-cwd=${b.legacyCwd} (report only, never converted)`);
    lines.push(
      `    legacy-storage-root=${b.legacyStorageRoot} (convertible=${b.legacyStorageRootConvertible})`
    );
    lines.push(`    invalid=${b.invalid}`);
    lines.push(`    null/missing-key=${b.null}`);
  }
  return lines.join("\n");
}
