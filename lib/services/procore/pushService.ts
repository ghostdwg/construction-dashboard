// Tier F F2 — Procore push operations
//
// Four push types, each returning a PushResult that drives the UI counters.
// All functions are idempotent: they find-or-create for vendors, skip
// duplicates for contacts/submittals, and upsert for budget lines.
//
// Procore API v1.0 base: https://api.procore.com/rest/v1.0

import { prisma } from "@/lib/prisma";
import { procoreGet, procorePost, procorePatch, ProcoreError, getCompanyId } from "./client";

// ── Result type ────────────────────────────────────────────────────────────

export type PushResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

function emptyResult(): PushResult {
  return { created: 0, updated: 0, skipped: 0, errors: [] };
}

function addError(result: PushResult, msg: string): void {
  if (result.errors.length < 50) result.errors.push(msg);
}

// ── Procore API types ──────────────────────────────────────────────────────

type ProcoreVendor = {
  id: number;
  name: string;
  email_address?: string;
  phone_number?: string;
  trade_name?: string;
};

type ProcorePerson = {
  id: number;
  first_name?: string;
  last_name?: string;
  email_address?: string;
};

type ProcoreCostCode = {
  id: number;
  code: string;
  full_code?: string;
  biller?: string;
};

type ProcoreSubmittalType = {
  id: number;
  name: string;
};

type ProcoreSubmittal = {
  id: number;
  title: string;
  spec_section?: string;
};

// ── Name split helper (mirrors contacts CSV export) ────────────────────────

function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return ["", parts[0]];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

// CSI code string → Procore-friendly cost code string (e.g. "03 30 00" → "03-300")
function deriveCostCode(csiCode: string | null | undefined): string {
  if (!csiCode) return "";
  const parts = csiCode.trim().split(/\s+/);
  if (parts.length >= 2) {
    const div = parts[0] ?? "";
    const sub = (parts[1] ?? "").replace(/0+$/, "") || "000";
    return `${div}-${sub.padStart(3, "0")}`;
  }
  return csiCode.replace(/\s+/g, "-");
}

// ── 1. Push Vendors ────────────────────────────────────────────────────────
//
// Creates or updates company records in the Procore vendor directory.
// On create, saves the returned Procore vendor ID back to Subcontractor.procoreVendorId.
// On subsequent pushes, finds by procoreVendorId (if known) or by name search.

export async function pushVendors(bidId: number): Promise<PushResult> {
  const result = emptyResult();
  const companyId = await getCompanyId();

  // All subs on this bid (invited or awarded)
  const subs = await prisma.subcontractor.findMany({
    where: {
      OR: [
        { selections: { some: { bidId } } },
        { buyoutItems: { some: { bidId } } },
      ],
    },
    select: {
      id: true,
      company: true,
      procoreVendorId: true,
      contacts: {
        where: { isPrimary: true },
        select: { phone: true, email: true },
        take: 1,
      },
      buyoutItems: {
        where: { bidId },
        select: { bidTrade: { select: { trade: { select: { name: true } } } } },
        take: 1,
      },
      subTrades: {
        select: { trade: { select: { name: true } } },
        take: 1,
      },
    },
  });

  if (subs.length === 0) {
    result.skipped = 0;
    return result;
  }

  for (const sub of subs) {
    const contact = sub.contacts[0];
    const tradeName =
      sub.buyoutItems[0]?.bidTrade?.trade?.name ??
      sub.subTrades[0]?.trade?.name ??
      null;

    const vendorPayload = {
      vendor: {
        name: sub.company,
        ...(tradeName ? { trade_name: tradeName } : {}),
        ...(contact?.phone ? { phone_number: contact.phone } : {}),
        ...(contact?.email ? { email_address: contact.email } : {}),
      },
    };

    try {
      if (sub.procoreVendorId) {
        // Known vendor — update existing record
        await procorePatch<ProcoreVendor>(
          `/rest/v1.0/companies/${companyId}/vendors/${sub.procoreVendorId}`,
          vendorPayload
        );
        result.updated++;
      } else {
        // Unknown vendor — search by name first to avoid duplicates
        const existing = await procoreGet<ProcoreVendor[]>(
          `/rest/v1.0/companies/${companyId}/vendors?filters[name]=${encodeURIComponent(sub.company)}`
        );
        const found = existing.find(
          (v) => v.name.toLowerCase() === sub.company.toLowerCase()
        );

        if (found) {
          // Already exists — save the ID and count as updated
          await prisma.subcontractor.update({
            where: { id: sub.id },
            data: { procoreVendorId: String(found.id) },
          });
          result.updated++;
        } else {
          // Create new vendor
          const created = await procorePost<ProcoreVendor>(
            `/rest/v1.0/companies/${companyId}/vendors`,
            vendorPayload
          );
          await prisma.subcontractor.update({
            where: { id: sub.id },
            data: { procoreVendorId: String(created.id) },
          });
          result.created++;
        }
      }
    } catch (err) {
      const msg = err instanceof ProcoreError ? err.message : String(err);
      addError(result, `${sub.company}: ${msg}`);
    }
  }

  return result;
}

// ── 2. Push Contacts ───────────────────────────────────────────────────────
//
// Creates project team members in the Procore company directory.
// Skips contacts that already exist by email address.

export async function pushContacts(bidId: number): Promise<PushResult> {
  const result = emptyResult();
  const companyId = await getCompanyId();

  const contacts = await prisma.projectContact.findMany({
    where: { bidId },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  if (contacts.length === 0) return result;

  // Pre-fetch existing people to check for email duplicates
  const existingPeople = await procoreGet<ProcorePerson[]>(
    `/rest/v1.0/companies/${companyId}/people`
  ).catch(() => [] as ProcorePerson[]);
  const existingEmails = new Set(
    existingPeople
      .map((p) => p.email_address?.toLowerCase())
      .filter(Boolean) as string[]
  );

  for (const c of contacts) {
    const email = c.email?.toLowerCase();
    if (email && existingEmails.has(email)) {
      result.skipped++;
      continue;
    }

    const [firstName, lastName] = splitName(c.name);

    const personPayload = {
      person: {
        first_name: firstName || undefined,
        last_name: lastName,
        ...(c.email ? { email_address: c.email } : {}),
        ...(c.phone ? { business_phone: c.phone } : {}),
        ...(c.title ? { job_title: c.title } : {}),
        ...(c.company ? { company: c.company } : {}),
      },
    };

    try {
      await procorePost<ProcorePerson>(
        `/rest/v1.0/companies/${companyId}/people`,
        personPayload
      );
      result.created++;
      if (email) existingEmails.add(email); // avoid re-adding in same run
    } catch (err) {
      const msg = err instanceof ProcoreError ? err.message : String(err);
      addError(result, `${c.name}: ${msg}`);
    }
  }

  return result;
}

// ── 3. Push Submittals ─────────────────────────────────────────────────────
//
// Creates submittal items in the Procore submittal log for a linked project.
// Matches our SubmittalItem.type to Procore's submittal types by name.
// Skips items if a submittal with the same title already exists in Procore.

export async function pushSubmittals(
  bidId: number,
  procoreProjectId: string
): Promise<PushResult> {
  const result = emptyResult();

  // Fetch available submittal types in this Procore project
  let submittalTypes: ProcoreSubmittalType[] = [];
  try {
    submittalTypes = await procoreGet<ProcoreSubmittalType[]>(
      `/rest/v1.0/projects/${procoreProjectId}/submittal_types`
    );
  } catch {
    // Non-fatal: we'll skip type matching and send type_id null
  }

  const typeByName = new Map(
    submittalTypes.map((t) => [t.name.toLowerCase(), t.id])
  );

  // Map our internal types to Procore type names
  const OUR_TO_PROCORE_TYPE: Record<string, string[]> = {
    SHOP_DRAWING: ["shop drawing", "shop drawings"],
    PRODUCT_DATA: ["product data", "product data sheet", "submittal"],
    SAMPLE: ["sample", "samples", "color sample"],
    CLOSEOUT: ["closeout", "closeout submittal", "operation & maintenance"],
    LEED: ["leed", "sustainability"],
    OTHER: [],
  };

  function resolveTypeId(ourType: string): number | null {
    const candidates = OUR_TO_PROCORE_TYPE[ourType] ?? [];
    for (const candidate of candidates) {
      const id = typeByName.get(candidate);
      if (id !== undefined) return id;
    }
    // Fallback: find any type that partially matches
    for (const [name, id] of typeByName) {
      for (const candidate of candidates) {
        if (name.includes(candidate) || candidate.includes(name)) return id;
      }
    }
    return null;
  }

  // Fetch existing Procore submittals to avoid duplicates
  let existingSubmittals: ProcoreSubmittal[] = [];
  try {
    existingSubmittals = await procoreGet<ProcoreSubmittal[]>(
      `/rest/v1.0/projects/${procoreProjectId}/submittals`
    );
  } catch {
    // Non-fatal: proceed without dedup check
  }
  const existingTitles = new Set(
    existingSubmittals.map((s) => s.title.toLowerCase())
  );

  const submittalItems = await prisma.submittalItem.findMany({
    where: { bidId },
    include: { specSection: { select: { csiNumber: true } } },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });

  for (const item of submittalItems) {
    const title = item.title ?? item.description ?? "Submittal";
    if (existingTitles.has(title.toLowerCase())) {
      result.skipped++;
      continue;
    }

    const submittalTypeId = resolveTypeId(item.type ?? "OTHER");
    const specSection = item.specSection?.csiNumber ?? null;

    const payload: Record<string, unknown> = {
      submittal: {
        title,
        ...(specSection ? { spec_section: specSection } : {}),
        ...(submittalTypeId !== null
          ? { submittal_type_id: submittalTypeId }
          : {}),
      },
    };

    try {
      await procorePost<ProcoreSubmittal>(
        `/rest/v1.0/projects/${procoreProjectId}/submittals`,
        payload
      );
      result.created++;
      existingTitles.add(title.toLowerCase());
    } catch (err) {
      const msg = err instanceof ProcoreError ? err.message : String(err);
      addError(result, `"${title}": ${msg}`);
    }
  }

  return result;
}

// ── 4. Push Budget ─────────────────────────────────────────────────────────
//
// Creates budget line items in the Procore project budget.
// Fetches the project's cost codes and matches them by code string.
// GC overhead lines use cost codes from H6; trade lines use the BidTrade's
// cost code or a CSI-derived code.
// Lines that cannot be matched to a Procore cost code are skipped with errors.

type GcLine = { label: string; costCode: string; amount: number };

export async function pushBudget(
  bidId: number,
  procoreProjectId: string
): Promise<PushResult> {
  const result = emptyResult();

  // Fetch all cost codes in this Procore project
  let costCodes: ProcoreCostCode[] = [];
  try {
    costCodes = await procoreGet<ProcoreCostCode[]>(
      `/rest/v1.0/projects/${procoreProjectId}/cost_codes`
    );
  } catch (err) {
    const msg = err instanceof ProcoreError ? err.message : String(err);
    addError(result, `Failed to fetch cost codes: ${msg}`);
    return result;
  }

  // Build lookup maps: full_code → id AND code → id (fallback)
  const codeById = new Map<string, number>();
  for (const cc of costCodes) {
    if (cc.full_code) codeById.set(cc.full_code.toLowerCase(), cc.id);
    codeById.set(cc.code.toLowerCase(), cc.id);
  }

  function findCostCodeId(codeStr: string): number | null {
    const lower = codeStr.toLowerCase();
    // Exact match
    if (codeById.has(lower)) return codeById.get(lower)!;
    // Partial prefix match (e.g. "03" matches "03-000")
    for (const [key, id] of codeById) {
      if (key.startsWith(lower) || lower.startsWith(key.split("-")[0] ?? "")) {
        // Only return if the division matches exactly
        const keyDiv = key.split("-")[0] ?? key.split(" ")[0];
        const ourDiv = lower.split("-")[0] ?? lower.split(" ")[0];
        if (keyDiv === ourDiv) return id;
      }
    }
    return null;
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { budgetGcLines: true },
  });

  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    include: {
      trade: { select: { name: true, csiCode: true, costCode: true } },
      buyoutItem: { select: { committedAmount: true } },
    },
    orderBy: { trade: { csiCode: "asc" } },
  });

  // Fetch existing budget lines to avoid duplicates
  type ProcoreBudgetLine = { id: number; cost_code?: { id: number } };
  let existingLines: ProcoreBudgetLine[] = [];
  try {
    existingLines = await procoreGet<ProcoreBudgetLine[]>(
      `/rest/v1.0/projects/${procoreProjectId}/budget_line_items`
    );
  } catch {
    // Non-fatal
  }
  const existingCostCodeIds = new Set(
    existingLines.map((l) => l.cost_code?.id).filter(Boolean)
  );

  // Push trade lines
  for (const bt of bidTrades) {
    const codeStr = bt.trade.costCode ?? deriveCostCode(bt.trade.csiCode);
    const costCodeId = codeStr ? findCostCodeId(codeStr) : null;

    if (!costCodeId) {
      addError(
        result,
        `${bt.trade.name}: no cost code match for "${codeStr}" — skipped`
      );
      result.skipped++;
      continue;
    }

    if (existingCostCodeIds.has(costCodeId)) {
      result.skipped++;
      continue;
    }

    const amount = bt.buyoutItem?.committedAmount ?? 0;

    try {
      await procorePost(
        `/rest/v1.0/projects/${procoreProjectId}/budget_line_items`,
        {
          budget_line_item: {
            cost_code_id: costCodeId,
            description: bt.trade.name,
            original_budget_amount: amount,
            cost_type: "subcontract",
          },
        }
      );
      result.created++;
      existingCostCodeIds.add(costCodeId);
    } catch (err) {
      const msg = err instanceof ProcoreError ? err.message : String(err);
      addError(result, `${bt.trade.name}: ${msg}`);
    }
  }

  // Push GC overhead lines
  let gcLines: GcLine[] = [];
  if (bid?.budgetGcLines) {
    try {
      const parsed = JSON.parse(bid.budgetGcLines) as GcLine[];
      if (Array.isArray(parsed)) gcLines = parsed;
    } catch {
      // ignore
    }
  }

  for (const line of gcLines) {
    const costCodeId = line.costCode ? findCostCodeId(line.costCode) : null;

    if (!costCodeId) {
      addError(
        result,
        `GC "${line.label}": no cost code match for "${line.costCode}" — skipped`
      );
      result.skipped++;
      continue;
    }

    if (existingCostCodeIds.has(costCodeId)) {
      result.skipped++;
      continue;
    }

    try {
      await procorePost(
        `/rest/v1.0/projects/${procoreProjectId}/budget_line_items`,
        {
          budget_line_item: {
            cost_code_id: costCodeId,
            description: line.label,
            original_budget_amount: line.amount,
            cost_type: "general_overhead",
          },
        }
      );
      result.created++;
      existingCostCodeIds.add(costCodeId);
    } catch (err) {
      const msg = err instanceof ProcoreError ? err.message : String(err);
      addError(result, `GC "${line.label}": ${msg}`);
    }
  }

  return result;
}
