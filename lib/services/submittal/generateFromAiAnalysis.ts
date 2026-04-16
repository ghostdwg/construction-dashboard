// Phase 5G-1 — Generate Submittal Register from AI Spec Analysis
//
// Reads every SpecSection.aiExtractions for the bid and creates SubmittalItem
// records from the AI-extracted submittals. Each item is linked to its
// SpecSection (specSectionId) and — when available — to a BidTrade (bidTradeId)
// via the section's matched trade.
//
// Idempotent: skips any item where (bidId, specSectionId, type, title) already
// exists from a prior run. Safe to re-run after re-analyzing the spec book.

import { prisma } from "@/lib/prisma";
import { SUBMITTAL_TYPES, type SubmittalType } from "./seedSubmittalRegister";

type AiSubmittal = {
  type: string;
  description: string;
  engineer_review?: boolean;
};

type AiExtraction = {
  submittals?: AiSubmittal[];
  severity?: string;
};

function normalizeType(raw: string): SubmittalType {
  const upper = raw.trim().toUpperCase();
  if ((SUBMITTAL_TYPES as readonly string[]).includes(upper)) {
    return upper as SubmittalType;
  }
  return "OTHER";
}

// These belong to the CLOSEOUT register (future module), not the active
// construction submittal register. Keep extractions in aiExtractions JSON
// so Closeout module can pick them up — but don't create SubmittalItem rows.
// Types excluded from the submittal register entirely
const EXCLUDED_TYPES: SubmittalType[] = ["CERT", "LEED"];

// Filter out obviously generic boilerplate extractions (e.g., "Product Data"
// with no specifics). These are AI noise from section header skim.
const GENERIC_LABELS = /^(product\s*data|shop\s*drawings?|samples?|warranty|warranties|training|mockups?|certificates?|certifications?|submittals?)\.?$/i;

function isGenericBoilerplate(desc: string): boolean {
  const cleaned = desc.trim().replace(/[.,]+$/, "");
  if (GENERIC_LABELS.test(cleaned)) return true;
  if (cleaned.split(/\s+/).length < 3) return true;
  return false;
}

// Human-readable labels for the submittal type suffix
const TYPE_LABELS: Record<SubmittalType, string> = {
  PRODUCT_DATA: "Product Data",
  SHOP_DRAWING: "Shop Drawings",
  SAMPLE: "Samples",
  MOCKUP: "Mockup",
  WARRANTY: "Warranty",
  O_AND_M: "O&M Manual",
  LEED: "LEED Documentation",
  CERT: "Certification",
  OTHER: "Submittal",
};

// Strip imperative verb prefixes (spec writers love "Submit shop drawings...")
const VERB_PREFIX = /^(submit|provide|furnish|include|deliver|prepare|issue|supply|forward)\s+/i;

// Strip trailing noise ("for approval", "as required", "indicated in triplicate (3 copies)")
const TRAILING_NOISE = /\s+(for\s+(approval|review|acceptance|use|the\s+\w+).*|indicated\s+in.*|as\s+required.*|per\s+section.*|per\s+specification.*|in\s+accordance\s+with.*)$/i;

function cleanDescription(raw: string): string {
  let t = raw.trim();
  t = t.replace(VERB_PREFIX, "");
  t = t.replace(TRAILING_NOISE, "");
  // Strip leading articles
  t = t.replace(/^(the|a|an)\s+/i, "");
  // Drop parenthetical copies/counts like "(3 copies)" or "(triplicate)"
  t = t.replace(/\s*\(\s*\d+\s*cop(y|ies)\s*\)/i, "");
  t = t.replace(/\s*\((?:triplicate|duplicate|quadruplicate)\)/i, "");
  return t.trim().replace(/[,.;:\s]+$/, "");
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Strong indicators that the cleaned description is a sentence/instruction
// rather than a product name — "with", "for", "that", "which", verbs in the
// middle. If any of these appear, it's not a good title source.
const SENTENCE_MARKERS = /\b(with|for\s+\w+ing|that|which|shall|must|including|containing|indicating|showing|per\s+\w+|as\s+\w+ified|as\s+specified|as\s+required)\b/i;

function isLikelyProductName(cleaned: string): boolean {
  // Good product-name titles are short, 2–6 words, noun-like phrases
  const wordCount = cleaned.split(/\s+/).length;
  if (cleaned.length > 42) return false;         // too long to be a label
  if (wordCount > 6) return false;               // too many words
  if (wordCount < 2) return false;               // single words are always garbled
  if (SENTENCE_MARKERS.test(cleaned)) return false;  // contains sentence patterns
  if (/[.;:]\s+\w/.test(cleaned)) return false;  // has multiple clauses
  return true;
}

function deriveTitle(description: string, csiTitle: string, type: SubmittalType): string {
  const typeLabel = TYPE_LABELS[type];
  const cleaned = cleanDescription(description);

  // Default title: "{CSI Title} – {Type Label}" — Procore-style.
  // Clean, predictable, always readable. The full spec text lives in
  // the description field, so no info is lost.
  const defaultTitle = `${csiTitle} – ${typeLabel}`;

  // Override only when the cleaned description looks like a clean product name
  // (short, noun-like, no sentence markers). Otherwise stick with the default.
  if (!isLikelyProductName(cleaned)) {
    return defaultTitle;
  }

  const subject = titleCase(cleaned);
  const lower = subject.toLowerCase();
  const alreadyHasType = lower.includes(typeLabel.toLowerCase().split(" ")[0]);
  return alreadyHasType ? subject : `${subject} – ${typeLabel}`;
}

export type GenerateResult = {
  sectionsScanned: number;
  sectionsWithExtractions: number;
  submittalsFound: number;
  created: number;
  skipped: number;
  skippedBoilerplate: number;
  skippedProcedural: number;  // Divisions 00 + 01 — procedural, not register items
  deferredToCloseout: number;
  bidTradesLinked: number;
  previousAutoItemsRemoved: number;
};

// Division 00 = Procurement (bid docs, instructions to bidders)
// Division 01 = General Requirements (submittal procedures, closeout procedures,
// coordination rules — META content that defines HOW other registers work,
// not register items themselves)
const PROCEDURAL_DIVISIONS = new Set(["00", "01"]);

export async function generateSubmittalsFromAiAnalysis(
  bidId: number
): Promise<GenerateResult> {
  // AI is now the source of truth for the submittal register. Wipe any
  // prior auto-generated items (both AI and regex seed) so we don't
  // double-count. Manual entries are preserved.
  const removed = await prisma.submittalItem.deleteMany({
    where: { bidId, source: { in: ["ai_extraction", "regex_seed"] } },
  });

  // Also wipe auto-generated packages (ones with no remaining manual items).
  // User's renamed/edited packages persist because `name` won't match the
  // trade name we'd regenerate.
  await prisma.submittalPackage.deleteMany({
    where: {
      bidId,
      items: { none: {} },  // empty packages only
    },
  });
  // Load latest spec book with sections that have AI extractions
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        where: { aiExtractions: { not: null } },
        select: {
          id: true,
          csiNumber: true,
          csiTitle: true,
          csiCanonicalTitle: true,
          aiExtractions: true,
          tradeId: true,
          matchedTradeId: true,
        },
      },
    },
  });

  if (!specBook) {
    throw new Error("No spec book found for this bid");
  }

  if (specBook.sections.length === 0) {
    return {
      sectionsScanned: 0,
      sectionsWithExtractions: 0,
      submittalsFound: 0,
      created: 0,
      skipped: 0,
      skippedBoilerplate: 0,
      skippedProcedural: 0,
      deferredToCloseout: 0,
      bidTradesLinked: 0,
      previousAutoItemsRemoved: removed.count,
    };
  }

  const [bidTrades, existing] = await Promise.all([
    prisma.bidTrade.findMany({ where: { bidId }, select: { id: true, tradeId: true } }),
    prisma.submittalItem.findMany({ where: { bidId }, select: { specSectionId: true, type: true, title: true } }),
  ]);
  const tradeToBidTrade = new Map(bidTrades.map((bt) => [bt.tradeId, bt.id]));
  const existingKey = new Set(
    existing.map((s) => `${s.specSectionId}|${s.type}|${s.title.toLowerCase()}`)
  );

  let submittalsFound = 0;
  let created = 0;
  let skipped = 0;
  let skippedBoilerplate = 0;
  let skippedProcedural = 0;
  let deferredToCloseout = 0;
  let bidTradesLinked = 0;

  // Accumulator — collect all descriptions for the same (section, type) so we
  // produce ONE merged submittal row per bucket instead of many near-duplicates.
  type Bucket = {
    sectionId: number;
    sectionTitle: string;
    type: SubmittalType;
    bidTradeId: number | null;
    descriptions: string[];
    engineerReview: boolean;
  };
  const buckets = new Map<string, Bucket>();

  for (const section of specBook.sections) {
    if (!section.aiExtractions) continue;

    // Skip procedural divisions (00 + 01) — they define HOW submittals work,
    // not the submittals themselves. Division 01 content informs the rules
    // for other registers; it doesn't become register items.
    const division = section.csiNumber.slice(0, 2);
    if (PROCEDURAL_DIVISIONS.has(division)) {
      skippedProcedural++;
      continue;
    }

    let extraction: AiExtraction;
    try {
      extraction = JSON.parse(section.aiExtractions) as AiExtraction;
    } catch {
      continue;
    }

    const submittals = Array.isArray(extraction.submittals) ? extraction.submittals : [];
    if (submittals.length === 0) continue;

    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const bidTradeId = tradeId ? tradeToBidTrade.get(tradeId) ?? null : null;
    const sectionTitle = section.csiCanonicalTitle ?? section.csiTitle;

    for (const sub of submittals) {
      submittalsFound++;
      const description = (sub.description || "").trim();
      if (!description) {
        skipped++;
        continue;
      }

      const type = normalizeType(sub.type || "OTHER");

      // Skip generic AI boilerplate that names no specific deliverable
      if (isGenericBoilerplate(description)) {
        skippedBoilerplate++;
        continue;
      }

      if (EXCLUDED_TYPES.includes(type)) {
        deferredToCloseout++;
        continue;
      }

      const bucketKey = `${section.id}|${type}`;

      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          sectionId: section.id,
          sectionTitle,
          type,
          bidTradeId,
          descriptions: [],
          engineerReview: false,
        };
        buckets.set(bucketKey, bucket);
      }
      bucket.descriptions.push(description);
      if (sub.engineer_review) bucket.engineerReview = true;
    }
  }

  // Pre-compute: for each bidTradeId used by any bucket, ensure a
  // SubmittalPackage exists. "UNASSIGNED" is used for items with no trade.
  const tradesNeedingPackages = new Set<number | null>();
  for (const b of buckets.values()) tradesNeedingPackages.add(b.bidTradeId);

  const bidTradesWithNames = await prisma.bidTrade.findMany({
    where: { bidId, id: { in: Array.from(tradesNeedingPackages).filter((v): v is number => v !== null) } },
    include: { trade: { select: { name: true } } },
  });
  const bidTradeNameById = new Map(bidTradesWithNames.map((bt) => [bt.id, bt.trade.name]));

  // Load already-existing packages (both user-managed and prior auto) for dedupe
  const existingPackages = await prisma.submittalPackage.findMany({
    where: { bidId },
    select: { id: true, bidTradeId: true, name: true, packageNumber: true },
  });
  const packageByTradeId = new Map<number | null, number>();
  for (const p of existingPackages) packageByTradeId.set(p.bidTradeId, p.id);

  // Count existing package numbers to avoid collisions on new ones
  const existingPkgNumbers = new Set(existingPackages.map((p) => p.packageNumber));
  let nextPkgSeq = 1;
  const allocatePackageNumber = (): string => {
    while (existingPkgNumbers.has(`PKG-${String(nextPkgSeq).padStart(2, "0")}`)) {
      nextPkgSeq++;
    }
    const num = `PKG-${String(nextPkgSeq).padStart(2, "0")}`;
    existingPkgNumbers.add(num);
    nextPkgSeq++;
    return num;
  };

  // Create any missing packages in parallel
  const missingPackages = Array.from(tradesNeedingPackages).filter(
    (tradeId) => !packageByTradeId.has(tradeId)
  );
  if (missingPackages.length > 0) {
    const newPkgs = await Promise.all(
      missingPackages.map((tradeId) => {
        const name = tradeId === null ? "Unassigned" : bidTradeNameById.get(tradeId) ?? "Unassigned";
        return prisma.submittalPackage.create({
          data: { bidId, bidTradeId: tradeId, packageNumber: allocatePackageNumber(), name, status: "DRAFT" },
        });
      })
    );
    for (const pkg of newPkgs) packageByTradeId.set(pkg.bidTradeId, pkg.id);
  }

  // Build all items, filter dupes, then batch-insert
  const itemsToCreate: {
    bidId: number; bidTradeId: number | null; packageId: number | null;
    specSectionId: number; type: string; title: string; description: string;
    source: string; status: string; notes: string | null;
  }[] = [];

  for (const bucket of buckets.values()) {
    const title = deriveTitle(bucket.descriptions[0], bucket.sectionTitle, bucket.type);
    const key = `${bucket.sectionId}|${bucket.type}|${title.toLowerCase()}`;
    if (existingKey.has(key)) { skipped++; continue; }

    const mergedDescription =
      bucket.descriptions.length === 1
        ? bucket.descriptions[0]
        : bucket.descriptions.map((d) => `• ${d}`).join("\n");

    itemsToCreate.push({
      bidId,
      bidTradeId: bucket.bidTradeId,
      packageId: packageByTradeId.get(bucket.bidTradeId) ?? null,
      specSectionId: bucket.sectionId,
      type: bucket.type,
      title,
      description: mergedDescription,
      source: "ai_extraction",
      status: "PENDING",
      notes: bucket.engineerReview ? "Engineer review required" : null,
    });
    if (bucket.bidTradeId) bidTradesLinked++;
  }

  if (itemsToCreate.length > 0) {
    await prisma.submittalItem.createMany({ data: itemsToCreate });
  }
  created = itemsToCreate.length;

  return {
    sectionsScanned: specBook.sections.length,
    sectionsWithExtractions: specBook.sections.length,
    submittalsFound,
    created,
    skipped,
    skippedBoilerplate,
    skippedProcedural,
    deferredToCloseout,
    bidTradesLinked,
    previousAutoItemsRemoved: removed.count,
  };
}
