// CSI MasterFormat baseline submittal seeder
//
// Generates industry-standard submittals for each spec section based on its
// CSI division/subdivision number. Works without AI or clean spec text —
// matches against the section's csiNumber and emits expected deliverables.
//
// Used as a fallback when AI extraction yields 0 items (spec not yet analyzed).
// Source tag: "csi_baseline" — cleaned up by generateFromAiAnalysis on next run.

import { prisma } from "@/lib/prisma";
import type { SubmittalType } from "./seedSubmittalRegister";

type BaselineItem = {
  title: string;
  type: SubmittalType;
  engineerReview?: boolean;
};

type BaselineRecord = {
  // Matches against the numeric-only CSI number prefix (e.g. "03", "053", "0851")
  prefix: string;
  items: BaselineItem[];
};

// ── Lookup table ─────────────────────────────────────────────────────────────
// Sorted longest-prefix-first so more-specific entries take priority.

const CSI_BASELINE: BaselineRecord[] = [
  // ── Division 02 — Existing Conditions ───────────────────────────────────
  { prefix: "02", items: [
    { title: "Demolition Plan",                         type: "SHOP_DRAWING" },
    { title: "Hazardous Material Survey Report",        type: "OTHER" },
  ]},

  // ── Division 03 — Concrete ───────────────────────────────────────────────
  { prefix: "03", items: [
    { title: "Concrete Mix Design",                     type: "CERT",         engineerReview: true },
    { title: "Concrete Admixture Product Data",         type: "PRODUCT_DATA" },
    { title: "Reinforcing Steel Shop Drawings",         type: "SHOP_DRAWING", engineerReview: true },
    { title: "Reinforcing Steel Mill Certificates",     type: "CERT",         engineerReview: true },
    { title: "Concrete Formwork Shop Drawings",         type: "SHOP_DRAWING", engineerReview: true },
    { title: "Concrete Curing Compound Product Data",   type: "PRODUCT_DATA" },
    { title: "Post-Tensioning Shop Drawings",           type: "SHOP_DRAWING", engineerReview: true },
    { title: "Concrete Repair Material Product Data",   type: "PRODUCT_DATA" },
    { title: "Embedded Anchor Product Data",            type: "PRODUCT_DATA", engineerReview: true },
  ]},

  // ── Division 04 — Masonry ────────────────────────────────────────────────
  { prefix: "04", items: [
    { title: "Masonry Unit Product Data",               type: "PRODUCT_DATA" },
    { title: "Masonry Unit Samples",                    type: "SAMPLE" },
    { title: "Mortar Product Data",                     type: "PRODUCT_DATA" },
    { title: "Masonry Reinforcing Product Data",        type: "PRODUCT_DATA" },
    { title: "Masonry Accessories Product Data",        type: "PRODUCT_DATA" },
    { title: "Sample Panel",                            type: "MOCKUP" },
  ]},

  // ── Division 05 — Metals ─────────────────────────────────────────────────
  { prefix: "051", items: [
    { title: "Structural Steel Shop Drawings",          type: "SHOP_DRAWING", engineerReview: true },
    { title: "Structural Steel Mill Certificates",      type: "CERT",         engineerReview: true },
    { title: "Anchor Bolt Setting Plan",                type: "SHOP_DRAWING", engineerReview: true },
    { title: "Bolt Certification",                      type: "CERT" },
  ]},
  { prefix: "053", items: [
    { title: "Steel Deck Shop Drawings",                type: "SHOP_DRAWING", engineerReview: true },
    { title: "Steel Deck Product Data",                 type: "PRODUCT_DATA" },
  ]},
  { prefix: "055", items: [
    { title: "Miscellaneous Metals Shop Drawings",      type: "SHOP_DRAWING" },
    { title: "Metal Railing Shop Drawings",             type: "SHOP_DRAWING" },
    { title: "Metal Stair Shop Drawings",               type: "SHOP_DRAWING", engineerReview: true },
  ]},

  // ── Division 06 — Wood, Plastics, Composites ─────────────────────────────
  { prefix: "0618", items: [
    { title: "Engineered Wood Product Data",            type: "PRODUCT_DATA", engineerReview: true },
    { title: "Engineered Wood Shop Drawings",           type: "SHOP_DRAWING", engineerReview: true },
  ]},
  { prefix: "064", items: [
    { title: "Architectural Woodwork Shop Drawings",    type: "SHOP_DRAWING" },
    { title: "Casework Product Data",                   type: "PRODUCT_DATA" },
    { title: "Casework Samples",                        type: "SAMPLE" },
    { title: "Countertop Samples",                      type: "SAMPLE" },
  ]},
  { prefix: "061", items: [
    { title: "Rough Carpentry Product Data",            type: "PRODUCT_DATA" },
    { title: "Pressure-Treated Lumber Treatment Certificate", type: "CERT" },
    { title: "Sheathing Product Data",                  type: "PRODUCT_DATA" },
  ]},

  // ── Division 07 — Thermal and Moisture Protection ────────────────────────
  { prefix: "071", items: [
    { title: "Waterproofing Product Data",              type: "PRODUCT_DATA" },
    { title: "Waterproofing Installation Instructions", type: "PRODUCT_DATA" },
    { title: "Waterproofing Warranty",                  type: "WARRANTY" },
  ]},
  { prefix: "072", items: [
    { title: "Insulation Product Data",                 type: "PRODUCT_DATA" },
    { title: "Insulation Flame-Spread/Smoke-Developed Index", type: "CERT" },
  ]},
  { prefix: "073", items: [
    { title: "Roofing Product Data",                    type: "PRODUCT_DATA" },
    { title: "Roofing Material Samples",                type: "SAMPLE" },
    { title: "Roofing Manufacturer Warranty",           type: "WARRANTY" },
    { title: "Roofing Installer Warranty",              type: "WARRANTY" },
  ]},
  { prefix: "075", items: [
    { title: "Membrane Roofing Product Data",           type: "PRODUCT_DATA" },
    { title: "Membrane Roofing Shop Drawings",          type: "SHOP_DRAWING" },
    { title: "Membrane Roofing Warranty",               type: "WARRANTY" },
    { title: "Tapered Insulation Shop Drawings",        type: "SHOP_DRAWING" },
  ]},
  { prefix: "076", items: [
    { title: "Sheet Metal Flashing Shop Drawings",      type: "SHOP_DRAWING" },
    { title: "Sheet Metal Product Data",                type: "PRODUCT_DATA" },
  ]},
  { prefix: "077", items: [
    { title: "Roof Accessories Product Data",           type: "PRODUCT_DATA" },
    { title: "Roof Hatch Product Data",                 type: "PRODUCT_DATA" },
  ]},
  { prefix: "079", items: [
    { title: "Joint Sealants Product Data",             type: "PRODUCT_DATA" },
    { title: "Joint Sealants Color Samples",            type: "SAMPLE" },
  ]},

  // ── Division 08 — Openings ───────────────────────────────────────────────
  { prefix: "081", items: [
    { title: "Door and Frame Shop Drawings",            type: "SHOP_DRAWING" },
    { title: "Door and Frame Product Data",             type: "PRODUCT_DATA" },
    { title: "Door Hardware Schedule",                  type: "PRODUCT_DATA" },
  ]},
  { prefix: "083", items: [
    { title: "Special Doors Product Data",              type: "PRODUCT_DATA" },
    { title: "Special Doors Shop Drawings",             type: "SHOP_DRAWING" },
  ]},
  { prefix: "084", items: [
    { title: "Storefront/Curtain Wall Shop Drawings",   type: "SHOP_DRAWING", engineerReview: true },
    { title: "Storefront/Curtain Wall Product Data",    type: "PRODUCT_DATA" },
    { title: "Curtain Wall Performance Test Reports",   type: "CERT",         engineerReview: true },
  ]},
  { prefix: "085", items: [
    { title: "Window Product Data",                     type: "PRODUCT_DATA" },
    { title: "Window Shop Drawings",                    type: "SHOP_DRAWING" },
    { title: "Window Performance Test Reports",         type: "CERT",         engineerReview: true },
  ]},
  { prefix: "087", items: [
    { title: "Door Hardware Product Data",              type: "PRODUCT_DATA" },
    { title: "Door Hardware Samples",                   type: "SAMPLE" },
  ]},
  { prefix: "088", items: [
    { title: "Glazing Product Data",                    type: "PRODUCT_DATA" },
    { title: "Glazing Samples",                         type: "SAMPLE" },
    { title: "Glazing Performance Test Reports",        type: "CERT" },
  ]},

  // ── Division 09 — Finishes ───────────────────────────────────────────────
  { prefix: "092", items: [
    { title: "Gypsum Board Product Data",               type: "PRODUCT_DATA" },
    { title: "Gypsum Board Accessories Product Data",   type: "PRODUCT_DATA" },
  ]},
  { prefix: "093", items: [
    { title: "Tile Product Data",                       type: "PRODUCT_DATA" },
    { title: "Tile Samples",                            type: "SAMPLE" },
    { title: "Tile Setting Material Product Data",      type: "PRODUCT_DATA" },
    { title: "Tile Grout Color Samples",                type: "SAMPLE" },
    { title: "Tile Waterproofing Membrane Product Data",type: "PRODUCT_DATA" },
  ]},
  { prefix: "095", items: [
    { title: "Acoustical Ceiling Product Data",         type: "PRODUCT_DATA" },
    { title: "Acoustical Ceiling Samples",              type: "SAMPLE" },
    { title: "Ceiling Grid Product Data",               type: "PRODUCT_DATA" },
  ]},
  { prefix: "096", items: [
    { title: "Flooring Product Data",                   type: "PRODUCT_DATA" },
    { title: "Flooring Samples",                        type: "SAMPLE" },
    { title: "Flooring Adhesive Product Data",          type: "PRODUCT_DATA" },
    { title: "Flooring Warranty",                       type: "WARRANTY" },
  ]},
  { prefix: "097", items: [
    { title: "Wall Covering Product Data",              type: "PRODUCT_DATA" },
    { title: "Wall Covering Samples",                   type: "SAMPLE" },
  ]},
  { prefix: "099", items: [
    { title: "Paint Product Data",                      type: "PRODUCT_DATA" },
    { title: "Paint Color Samples",                     type: "SAMPLE" },
    { title: "VOC Content Certificates",                type: "CERT" },
  ]},

  // ── Division 10 — Specialties ────────────────────────────────────────────
  { prefix: "101", items: [
    { title: "Signage Product Data",                    type: "PRODUCT_DATA" },
    { title: "Signage Shop Drawings",                   type: "SHOP_DRAWING" },
  ]},
  { prefix: "102", items: [
    { title: "Toilet Partition Product Data",           type: "PRODUCT_DATA" },
    { title: "Toilet Partition Samples",                type: "SAMPLE" },
    { title: "Toilet Partition Shop Drawings",          type: "SHOP_DRAWING" },
  ]},
  { prefix: "104", items: [
    { title: "Fire Protection Specialties Product Data",type: "PRODUCT_DATA" },
    { title: "Fire Extinguisher Product Data",          type: "PRODUCT_DATA" },
  ]},
  { prefix: "108", items: [
    { title: "Toilet and Bath Accessories Product Data",type: "PRODUCT_DATA" },
  ]},

  // ── Division 12 — Furnishings ────────────────────────────────────────────
  { prefix: "122", items: [
    { title: "Window Treatment Product Data",           type: "PRODUCT_DATA" },
    { title: "Window Treatment Samples",                type: "SAMPLE" },
  ]},

  // ── Division 21 — Fire Suppression ──────────────────────────────────────
  { prefix: "21", items: [
    { title: "Fire Suppression Shop Drawings",          type: "SHOP_DRAWING", engineerReview: true },
    { title: "Sprinkler Head Product Data",             type: "PRODUCT_DATA" },
    { title: "Hydraulic Calculations",                  type: "CERT",         engineerReview: true },
    { title: "Fire Suppression Equipment Product Data", type: "PRODUCT_DATA" },
    { title: "Fire Suppression O&M Manuals",            type: "O_AND_M" },
  ]},

  // ── Division 22 — Plumbing ───────────────────────────────────────────────
  { prefix: "22", items: [
    { title: "Plumbing Fixtures Product Data",          type: "PRODUCT_DATA" },
    { title: "Plumbing Equipment Product Data",         type: "PRODUCT_DATA" },
    { title: "Plumbing Shop Drawings",                  type: "SHOP_DRAWING" },
    { title: "Water Heater Product Data",               type: "PRODUCT_DATA" },
    { title: "Backflow Preventer Product Data",         type: "PRODUCT_DATA" },
    { title: "Plumbing Insulation Product Data",        type: "PRODUCT_DATA" },
    { title: "Plumbing O&M Manuals",                    type: "O_AND_M" },
  ]},

  // ── Division 23 — HVAC ───────────────────────────────────────────────────
  { prefix: "23", items: [
    { title: "HVAC Equipment Product Data",             type: "PRODUCT_DATA" },
    { title: "HVAC Equipment Shop Drawings",            type: "SHOP_DRAWING" },
    { title: "Ductwork Shop Drawings",                  type: "SHOP_DRAWING" },
    { title: "HVAC Controls Shop Drawings",             type: "SHOP_DRAWING", engineerReview: true },
    { title: "HVAC Controls Product Data",              type: "PRODUCT_DATA" },
    { title: "HVAC Duct Insulation Product Data",       type: "PRODUCT_DATA" },
    { title: "Air Terminal Unit Product Data",          type: "PRODUCT_DATA" },
    { title: "Fan and Ventilation Equipment Product Data", type: "PRODUCT_DATA" },
    { title: "HVAC O&M Manuals",                        type: "O_AND_M" },
  ]},

  // ── Division 26 — Electrical ─────────────────────────────────────────────
  { prefix: "26", items: [
    { title: "Panelboard Shop Drawings",                type: "SHOP_DRAWING", engineerReview: true },
    { title: "Panelboard Product Data",                 type: "PRODUCT_DATA" },
    { title: "Switchgear/Switchboard Product Data",     type: "PRODUCT_DATA" },
    { title: "Lighting Fixture Product Data",           type: "PRODUCT_DATA" },
    { title: "Emergency/Exit Lighting Product Data",    type: "PRODUCT_DATA" },
    { title: "Wiring Devices Product Data",             type: "PRODUCT_DATA" },
    { title: "Raceway and Conduit Product Data",        type: "PRODUCT_DATA" },
    { title: "Transformer Product Data",                type: "PRODUCT_DATA" },
    { title: "Generator Product Data",                  type: "PRODUCT_DATA" },
    { title: "Electrical O&M Manuals",                  type: "O_AND_M" },
  ]},

  // ── Division 27 — Communications ─────────────────────────────────────────
  { prefix: "27", items: [
    { title: "Communications Cabling Product Data",     type: "PRODUCT_DATA" },
    { title: "Communications Equipment Shop Drawings",  type: "SHOP_DRAWING" },
    { title: "AV/Communications Equipment Product Data",type: "PRODUCT_DATA" },
  ]},

  // ── Division 28 — Electronic Safety and Security ─────────────────────────
  { prefix: "281", items: [
    { title: "Fire Alarm Shop Drawings",                type: "SHOP_DRAWING", engineerReview: true },
    { title: "Fire Alarm Product Data",                 type: "PRODUCT_DATA" },
    { title: "Fire Alarm Battery Calculations",         type: "CERT" },
  ]},
  { prefix: "282", items: [
    { title: "Access Control Product Data",             type: "PRODUCT_DATA" },
    { title: "Access Control Shop Drawings",            type: "SHOP_DRAWING" },
  ]},
  { prefix: "283", items: [
    { title: "Video Surveillance Product Data",         type: "PRODUCT_DATA" },
    { title: "Video Surveillance Shop Drawings",        type: "SHOP_DRAWING" },
  ]},

  // ── Division 31 — Earthwork ──────────────────────────────────────────────
  { prefix: "312", items: [
    { title: "Grading/Earthwork Plan",                  type: "SHOP_DRAWING" },
    { title: "Erosion Control Plan",                    type: "SHOP_DRAWING" },
    { title: "Soil Compaction Test Reports",            type: "CERT" },
  ]},
  { prefix: "313", items: [
    { title: "Geotechnical/Soils Report",               type: "OTHER" },
    { title: "Soil Compaction Test Reports",            type: "CERT" },
  ]},
  { prefix: "316", items: [
    { title: "Pile/Caisson Shop Drawings",              type: "SHOP_DRAWING", engineerReview: true },
    { title: "Pile/Caisson Product Data",               type: "PRODUCT_DATA" },
  ]},

  // ── Division 32 — Exterior Improvements ─────────────────────────────────
  { prefix: "3213", items: [
    { title: "Concrete Paving Mix Design",              type: "CERT",         engineerReview: true },
    { title: "Concrete Paving Shop Drawings",           type: "SHOP_DRAWING" },
  ]},
  { prefix: "321", items: [
    { title: "Asphalt Paving Mix Design",               type: "CERT" },
    { title: "Asphalt Paving Product Data",             type: "PRODUCT_DATA" },
  ]},
  { prefix: "323", items: [
    { title: "Site Furnishings Product Data",           type: "PRODUCT_DATA" },
    { title: "Fencing Product Data",                    type: "PRODUCT_DATA" },
    { title: "Fencing Shop Drawings",                   type: "SHOP_DRAWING" },
    { title: "Retaining Wall Shop Drawings",            type: "SHOP_DRAWING", engineerReview: true },
  ]},
  { prefix: "328", items: [
    { title: "Irrigation Shop Drawings",                type: "SHOP_DRAWING" },
    { title: "Irrigation Product Data",                 type: "PRODUCT_DATA" },
    { title: "Irrigation Controller Product Data",      type: "PRODUCT_DATA" },
  ]},
  { prefix: "329", items: [
    { title: "Plant Material Schedule",                 type: "PRODUCT_DATA" },
    { title: "Planting Plan",                           type: "SHOP_DRAWING" },
    { title: "Sod/Seed Product Data",                   type: "PRODUCT_DATA" },
    { title: "Soil Amendment Product Data",             type: "PRODUCT_DATA" },
    { title: "Landscape Warranty",                      type: "WARRANTY" },
  ]},

  // ── Division 33 — Utilities ──────────────────────────────────────────────
  { prefix: "33", items: [
    { title: "Utility Piping Product Data",             type: "PRODUCT_DATA" },
    { title: "Utility Piping Shop Drawings",            type: "SHOP_DRAWING" },
  ]},
];

// Sort longest-prefix-first so more-specific entries are checked first.
CSI_BASELINE.sort((a, b) => b.prefix.length - a.prefix.length);

// ── Lookup ────────────────────────────────────────────────────────────────────

function normalizeCsi(csiNumber: string): string {
  return csiNumber.replace(/\D/g, "");
}

function getBaselineItems(csiNumber: string): BaselineItem[] {
  const norm = normalizeCsi(csiNumber);
  const matched: BaselineItem[] = [];
  const seenPrefixes = new Set<string>();

  for (const record of CSI_BASELINE) {
    if (norm.startsWith(record.prefix) && !seenPrefixes.has(record.prefix)) {
      seenPrefixes.add(record.prefix);
      matched.push(...record.items);
    }
  }
  return matched;
}

// ── Seeder ────────────────────────────────────────────────────────────────────

export type CsiBaselineResult = {
  sectionsScanned: number;
  sectionsMatched: number;
  created: number;
  skipped: number;
};

export async function seedCsiBaseline(bidId: number): Promise<CsiBaselineResult> {
  const result: CsiBaselineResult = { sectionsScanned: 0, sectionsMatched: 0, created: 0, skipped: 0 };

  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        select: { id: true, csiNumber: true, csiTitle: true, csiCanonicalTitle: true, tradeId: true, matchedTradeId: true },
      },
    },
  });
  if (!specBook || specBook.sections.length === 0) return result;

  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    select: { id: true, tradeId: true },
  });
  const tradeToBidTrade = new Map(bidTrades.map((bt) => [bt.tradeId, bt.id]));

  // Existing items — skip duplicates by (specSectionId, title)
  const existing = await prisma.submittalItem.findMany({
    where: { bidId, specSectionId: { not: null } },
    select: { specSectionId: true, title: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.specSectionId}|${e.title.toLowerCase().trim()}`)
  );

  const toCreate: {
    bidId: number; bidTradeId: number | null; specSectionId: number;
    title: string; type: string; status: string; source: string;
    notes: string | null;
  }[] = [];

  for (const section of specBook.sections) {
    result.sectionsScanned++;
    const baselineItems = getBaselineItems(section.csiNumber);
    if (baselineItems.length === 0) continue;
    result.sectionsMatched++;

    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const bidTradeId = tradeId ? tradeToBidTrade.get(tradeId) ?? null : null;

    for (const item of baselineItems) {
      const key = `${section.id}|${item.title.toLowerCase().trim()}`;
      if (existingKeys.has(key)) { result.skipped++; continue; }

      toCreate.push({
        bidId,
        bidTradeId,
        specSectionId: section.id,
        title: item.title,
        type: item.type,
        status: "PENDING",
        source: "csi_baseline",
        notes: item.engineerReview ? "Engineer review required" : null,
      });
      existingKeys.add(key);
    }
  }

  if (toCreate.length > 0) {
    await prisma.submittalItem.createMany({ data: toCreate });
  }
  result.created = toCreate.length;
  return result;
}
