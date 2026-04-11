// Module H3 — Submittal Register seeder
//
// Extracts required submittals from SpecSection.rawText using regex patterns
// tuned to CSI MasterFormat spec language. The seeder is:
//   - IDEMPOTENT — re-running won't duplicate items (checks specSectionId + title)
//   - DEFENSIVE — works on clean or garbled rawText; bad text yields fewer items
//   - ADDITIVE — never deletes existing items, only inserts new ones
//
// After seeding, the estimator manually manages items through the lifecycle.
// Responsible sub is auto-linked from BidInviteSelection.rfqStatus="accepted"
// when a BidTrade match exists for the spec section's trade.

import { prisma } from "@/lib/prisma";

// ── Types ───────────────────────────────────────────────────────────────────

export const SUBMITTAL_TYPES = [
  "PRODUCT_DATA",
  "SHOP_DRAWING",
  "SAMPLE",
  "MOCKUP",
  "WARRANTY",
  "O_AND_M",
  "LEED",
  "CERT",
  "OTHER",
] as const;

export type SubmittalType = (typeof SUBMITTAL_TYPES)[number];

export const SUBMITTAL_STATUSES = [
  "PENDING",
  "REQUESTED",
  "RECEIVED",
  "UNDER_REVIEW",
  "APPROVED",
  "APPROVED_AS_NOTED",
  "REJECTED",
  "RESUBMIT",
] as const;

export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];

export function isValidSubmittalType(s: string): s is SubmittalType {
  return (SUBMITTAL_TYPES as readonly string[]).includes(s);
}

export function isValidSubmittalStatus(s: string): s is SubmittalStatus {
  return (SUBMITTAL_STATUSES as readonly string[]).includes(s);
}

// ── Extraction ──────────────────────────────────────────────────────────────

type ExtractedSubmittal = {
  type: SubmittalType;
  title: string;
  description: string | null;
};

// Keyword → type classification. Ordered most-specific-first.
const TYPE_KEYWORDS: Array<{ type: SubmittalType; patterns: RegExp[] }> = [
  {
    type: "SHOP_DRAWING",
    patterns: [/shop\s*drawings?/i, /fabrication\s*drawings?/i, /erection\s*drawings?/i],
  },
  {
    type: "PRODUCT_DATA",
    patterns: [/product\s*data/i, /manufacturer'?s?\s*(?:data|literature)/i, /catalog\s*(?:cuts?|data)/i, /technical\s*data\s*sheets?/i],
  },
  {
    type: "SAMPLE",
    patterns: [/\bsamples?\b/i, /color\s*(?:samples?|chart)/i, /finish\s*samples?/i],
  },
  {
    type: "MOCKUP",
    patterns: [/mock[\s-]?ups?/i, /mock[\s-]?up\s*panels?/i],
  },
  {
    type: "WARRANTY",
    patterns: [/warrant(?:y|ies)/i, /warranty\s*certificates?/i],
  },
  {
    type: "O_AND_M",
    patterns: [/o\s*&\s*m\s*manuals?/i, /operation\s*(?:and|&)\s*maintenance/i, /maintenance\s*manuals?/i],
  },
  {
    type: "LEED",
    patterns: [/leed/i, /sustainable\s*design/i, /recycled\s*content/i, /regional\s*material/i, /voc\s*content/i],
  },
  {
    type: "CERT",
    patterns: [/certificat(?:e|ion)s?/i, /compliance\s*certificates?/i, /test\s*reports?/i, /mill\s*certificates?/i, /welder\s*certificat/i],
  },
];

// Classify a single line of submittal text into one of the enum types.
function classifySubmittalLine(line: string): SubmittalType {
  for (const { type, patterns } of TYPE_KEYWORDS) {
    for (const pattern of patterns) {
      if (pattern.test(line)) return type;
    }
  }
  return "OTHER";
}

/**
 * Locate a "SUBMITTALS" section in the raw spec text and return its content
 * block (up to the next major section heading or ~2000 chars). Case-insensitive.
 */
function extractSubmittalsBlock(rawText: string): string | null {
  if (!rawText) return null;

  // Normalize line endings and whitespace a bit, but keep newlines
  const text = rawText.replace(/\r\n/g, "\n");

  // Match common section heading variants:
  //   "1.3  SUBMITTALS"
  //   "1.03 SUBMITTALS"
  //   "SUBMITTALS"
  //   "PART 1 - SUBMITTALS"
  const startRe = /\b(?:\d+\.\d+\s+)?SUBMITTALS?\b\s*[:\n]/i;
  const startMatch = text.match(startRe);
  if (!startMatch || startMatch.index == null) return null;

  const blockStart = startMatch.index + startMatch[0].length;

  // End at the next numbered major section heading (e.g. "1.4", "1.04",
  // "PART 2", "QUALITY ASSURANCE", etc.) or 2000 chars max.
  const remaining = text.slice(blockStart);
  const endRe = /\n\s*(?:(?:\d+\.\d+)\s+[A-Z]|PART\s+\d+|QUALITY\s+ASSURANCE|DELIVERY[, ]|PRODUCTS|EXECUTION)/;
  const endMatch = remaining.match(endRe);
  const blockEnd = endMatch && endMatch.index != null ? endMatch.index : Math.min(remaining.length, 2000);

  return remaining.slice(0, blockEnd).trim();
}

/**
 * Parse lines out of a submittals block. Each non-empty line becomes a
 * candidate submittal. Lines that start with numbers/letters (A., 1., a.)
 * are treated as list items; headers in ALL CAPS are used as subsection
 * titles and merged into descriptions.
 */
function parseSubmittalLines(block: string): ExtractedSubmittal[] {
  const results: ExtractedSubmittal[] = [];
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // Deduplicate normalized titles within this block
  const seenTitles = new Set<string>();

  for (const rawLine of lines) {
    // Strip common list markers: "A.", "1.", "a)", "•", "-"
    const line = rawLine
      .replace(/^\s*(?:[A-Z0-9]+[.)]|[a-z]\)|[•\-*])\s+/, "")
      .trim();

    if (line.length < 4) continue;
    // Skip lines that look like headings (e.g. "SUBMITTALS", "PART 2")
    if (/^(SUBMITTALS|PART\s+\d+|QUALITY\s+ASSURANCE|PRODUCTS|EXECUTION)$/i.test(line)) continue;
    // Skip lines that are just "Submit the following:" type boilerplate
    if (/^submit\s+the\s+following[:.]?$/i.test(line)) continue;

    // Pull the first clause (up to first colon or period) as the title
    const splitMatch = line.match(/^([^:.]{4,120})[:.]?\s*(.*)$/);
    if (!splitMatch) continue;
    const rawTitle = splitMatch[1].trim();
    const description = splitMatch[2].trim() || null;

    // Normalize for dedup
    const normTitle = rawTitle.toLowerCase().replace(/\s+/g, " ");
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);

    // Must mention at least one submittal-relevant keyword to count
    const type = classifySubmittalLine(rawTitle);
    if (type === "OTHER") {
      // For OTHER, require the description to carry a keyword — else skip
      const combined = `${rawTitle} ${description ?? ""}`;
      const combinedType = classifySubmittalLine(combined);
      if (combinedType === "OTHER") continue;
      results.push({ type: combinedType, title: rawTitle, description });
    } else {
      results.push({ type, title: rawTitle, description });
    }
  }

  return results;
}

// ── Seeder ──────────────────────────────────────────────────────────────────

export type SeedResult = {
  sectionsScanned: number;
  sectionsWithSubmittals: number;
  itemsCreated: number;
  itemsSkipped: number; // already existed
};

/**
 * Scans every SpecSection for the bid and creates SubmittalItem rows for any
 * required submittals found. Idempotent: existing items (same specSectionId
 * + normalized title) are skipped.
 */
export async function seedSubmittalRegister(bidId: number): Promise<SeedResult> {
  const result: SeedResult = {
    sectionsScanned: 0,
    sectionsWithSubmittals: 0,
    itemsCreated: 0,
    itemsSkipped: 0,
  };

  // Pull all spec sections for this bid via their spec books
  const sections = await prisma.specSection.findMany({
    where: {
      specBook: { bidId },
    },
    select: {
      id: true,
      csiNumber: true,
      csiTitle: true,
      rawText: true,
      tradeId: true,
      matchedTradeId: true,
    },
  });

  if (sections.length === 0) return result;

  // Look up BidTrade rows so we can map spec-section trades to bidTradeIds
  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    select: { id: true, tradeId: true },
  });
  const bidTradeByTradeId = new Map(bidTrades.map((bt) => [bt.tradeId, bt.id]));

  // Look up accepted selections so we can auto-link a responsible sub
  const acceptedSelections = await prisma.bidInviteSelection.findMany({
    where: { bidId, rfqStatus: "accepted" },
    select: { tradeId: true, subcontractorId: true },
  });
  const subByTradeId = new Map<number, number>();
  for (const sel of acceptedSelections) {
    if (sel.tradeId != null && !subByTradeId.has(sel.tradeId)) {
      subByTradeId.set(sel.tradeId, sel.subcontractorId);
    }
  }

  // Look up existing submittals to avoid dup insertion
  const existing = await prisma.submittalItem.findMany({
    where: { bidId, specSectionId: { not: null } },
    select: { specSectionId: true, title: true },
  });
  const existingKeys = new Set<string>();
  for (const e of existing) {
    if (e.specSectionId != null) {
      existingKeys.add(`${e.specSectionId}::${e.title.toLowerCase().trim()}`);
    }
  }

  for (const section of sections) {
    result.sectionsScanned += 1;
    const block = extractSubmittalsBlock(section.rawText);
    if (!block) continue;

    const items = parseSubmittalLines(block);
    if (items.length === 0) continue;

    result.sectionsWithSubmittals += 1;

    // Resolve bidTrade + responsible sub for this section
    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const bidTradeId = tradeId != null ? bidTradeByTradeId.get(tradeId) ?? null : null;
    const responsibleSubId = tradeId != null ? subByTradeId.get(tradeId) ?? null : null;

    for (const item of items) {
      const key = `${section.id}::${item.title.toLowerCase().trim()}`;
      if (existingKeys.has(key)) {
        result.itemsSkipped += 1;
        continue;
      }

      // Build submittalNumber from CSI + sequence
      const seqInSection =
        Array.from(existingKeys).filter((k) => k.startsWith(`${section.id}::`)).length +
        1;
      const submittalNumber = `${section.csiNumber}-${String(seqInSection).padStart(2, "0")}`;

      await prisma.submittalItem.create({
        data: {
          bidId,
          bidTradeId,
          specSectionId: section.id,
          submittalNumber,
          title: item.title.slice(0, 200),
          description: item.description?.slice(0, 1000) ?? null,
          type: item.type,
          status: "PENDING",
          responsibleSubId,
        },
      });

      existingKeys.add(key);
      result.itemsCreated += 1;
    }
  }

  return result;
}
