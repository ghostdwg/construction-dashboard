// ── classifyTradeTier.ts ───────────────────────────────────────────────────
// Rule-based tier classification — no AI calls, no DB access.
// Used for auto-suggesting tiers on the Trades tab.

export type TradeTier = "TIER1" | "TIER2" | "TIER3";
export type CriticalPathRisk = "HIGH" | "MEDIUM" | "LOW";

export type TierClassification = {
  suggestedTier: TradeTier;
  reason: string;
  typicalLeadDays: number;
  criticalPathRisk: CriticalPathRisk;
};

// ── Keyword tables ────────────────────────────────────────────────────────
// Checked in order: TIER1, TIER3. No match → TIER2 default.

const TIER1_KEYWORDS = [
  "steel",
  "structural",
  "elevator",
  "escalator",
  "curtain wall",
  "glazing",
  "generator",
  "switchgear",
  "transformer",
  "roofing",
  "mechanical",
  "hvac",
  "plumbing",
  "fire protection",
  "sprinkler",
  "electrical",
  "low voltage",
  "telecom",
  "controls",
  "bas",
  "building automation",
  "precast",
  "concrete",
  "masonry",
  "excavation",
  "earthwork",
  "site utilities",
  "civil",
  // "data" kept separate — short word, check whole word boundary
];

// "data" needs a word-boundary check to avoid matching "drywall" or "update"
const TIER1_WHOLE_WORD_KEYWORDS = ["data"];

const TIER3_KEYWORDS = [
  "cleaning",
  "demolition",
  "signage",
  "specialties",
  "toilet accessories",
  "corner guards",
  "wall protection",
  "fire extinguishers",
  "mirrors",
  "shelving",
  "blinds",
  "window treatment",
  "furniture",
];

// ── Reasons per tier ──────────────────────────────────────────────────────

function tier1Reason(name: string): string {
  const n = name.toLowerCase();
  if (/elevator|escalator/.test(n)) return "Long lead — equipment procurement and installation coordination";
  if (/steel|structural|precast/.test(n)) return "Structural scope — fabrication lead and sequencing";
  if (/electrical|switchgear|transformer|generator/.test(n)) return "MEP scope — early design coordination and gear lead times";
  if (/mechanical|hvac/.test(n)) return "MEP scope — early design coordination and equipment procurement";
  if (/plumbing/.test(n)) return "MEP scope — rough-in sequencing and long lead fixtures";
  if (/fire protection|sprinkler/.test(n)) return "Life safety system — early coordination required";
  if (/low voltage|data|telecom|controls|bas|building automation/.test(n)) return "Specialty systems — design coordination and lead times";
  if (/curtain wall|glazing/.test(n)) return "Envelope scope — fabrication lead and waterproofing sequencing";
  if (/roofing/.test(n)) return "Envelope scope — weather-critical path";
  if (/concrete|masonry/.test(n)) return "Structural scope — early sequencing critical";
  if (/excavation|earthwork|civil|site utilities/.test(n)) return "Site work — must precede foundation and MEP";
  return "Critical path or long lead trade";
}

function tier3Reason(name: string): string {
  const n = name.toLowerCase();
  if (/cleaning/.test(n)) return "Commodity scope — standard industry availability";
  if (/demolition/.test(n)) return "Early access work — short scheduling window needed";
  if (/furniture/.test(n)) return "FF&E — typically owner-furnished or late procurement";
  return "Short lead commodity scope — standard availability";
}

// ── Main export ───────────────────────────────────────────────────────────

export function classifyTradeTier(tradeName: string): TierClassification {
  const lower = tradeName.toLowerCase();

  // TIER1 — phrase keywords first
  for (const kw of TIER1_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        suggestedTier: "TIER1",
        reason: tier1Reason(tradeName),
        typicalLeadDays: 21,
        criticalPathRisk: "HIGH",
      };
    }
  }

  // TIER1 — whole-word keywords
  for (const kw of TIER1_WHOLE_WORD_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(lower)) {
      return {
        suggestedTier: "TIER1",
        reason: tier1Reason(tradeName),
        typicalLeadDays: 21,
        criticalPathRisk: "HIGH",
      };
    }
  }

  // TIER3 — commodity/short lead
  for (const kw of TIER3_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        suggestedTier: "TIER3",
        reason: tier3Reason(tradeName),
        typicalLeadDays: 10,
        criticalPathRisk: "LOW",
      };
    }
  }

  // TIER2 — default
  return {
    suggestedTier: "TIER2",
    reason: "Standard trade — moderate lead time and scheduling",
    typicalLeadDays: 14,
    criticalPathRisk: "MEDIUM",
  };
}
