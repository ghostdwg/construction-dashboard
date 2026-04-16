// Module H4 — Schedule Seed: duration defaults by CSI division
//
// Ballpark activity durations (in working days) for typical mid-sized
// commercial construction. These are intentionally conservative starting
// points — the estimator adjusts per-activity in the Schedule tab.
//
// Keys are 2-digit CSI division strings ("03", "05", etc.). The lookup
// accepts any CSI code format ("03 30 00", "03-30-00", "0330", "03") and
// strips to the first 2 digits.

export const DEFAULT_DURATION_DAYS = 5;

// Canonical division order for sequencing. Earlier in the array = earlier
// in the construction schedule. Divisions not listed fall back to the end.
export const CSI_DIVISION_SEQUENCE: string[] = [
  "31", // Earthwork / Sitework
  "32", // Exterior improvements
  "33", // Utilities
  "02", // Existing conditions / demo
  "03", // Concrete
  "04", // Masonry
  "05", // Metals (structural steel)
  "06", // Wood & Plastics (rough carpentry / framing)
  "07", // Thermal & Moisture (roofing, waterproofing)
  "08", // Openings (doors/windows/storefront)
  "22", // Plumbing (rough)
  "23", // HVAC (rough)
  "26", // Electrical (rough)
  "27", // Communications
  "28", // Electronic safety & security
  "21", // Fire suppression
  "09", // Finishes (drywall, flooring, painting)
  "10", // Specialties (toilet partitions, signage)
  "11", // Equipment
  "12", // Furnishings
  "13", // Special construction
  "14", // Conveying (elevators)
  "25", // Integrated automation
  "01", // General requirements (commissioning wraps the job)
];

// Duration defaults per CSI division (working days). Tuned for mid-size
// commercial projects; solo estimator can override per-activity.
export const DIVISION_DURATION_DAYS: Record<string, number> = {
  "01": 10, // General requirements / commissioning
  "02": 8,  // Demo / existing conditions
  "03": 20, // Concrete (foundations + SOG + slabs)
  "04": 15, // Masonry
  "05": 12, // Structural steel
  "06": 14, // Rough carpentry / framing
  "07": 12, // Roofing + waterproofing
  "08": 10, // Openings
  "09": 18, // Finishes
  "10": 5,  // Specialties
  "11": 5,  // Equipment
  "12": 5,  // Furnishings
  "13": 8,  // Special construction
  "14": 15, // Elevators
  "21": 8,  // Fire suppression rough/trim
  "22": 15, // Plumbing rough
  "23": 18, // HVAC rough
  "25": 5,  // Integrated automation
  "26": 18, // Electrical rough
  "27": 8,  // Communications
  "28": 8,  // Security
  "31": 15, // Earthwork / sitework
  "32": 10, // Exterior improvements
  "33": 12, // Utilities
};

// Long-lead procurement total durations (working days) by CSI division.
// Represents submittal prep + review/approval + fabrication lead time.
// Used by the V2 seeder to populate the Procurement phase.
//
//  05 Structural steel / PEMB  →  7 (sub) + 10 (review) + 35 (fab) = 52
//  07 Curtainwall / panels     →  5 + 10 + 30 = 45
//  08 Storefront / OH doors    →  7 +  0 + 30 = 37
//  23 RTU / HVAC equipment     →  5 + 10 + 35 = 50
//  26 Switchgear / gear        →  5 +  5 + 30 = 40
export const LONG_LEAD_PROCUREMENT: Record<string, number> = {
  "05": 52,
  "07": 45,
  "08": 37,
  "23": 50,
  "26": 40,
};

/**
 * Normalize any CSI code-ish string to the 2-digit division.
 * Returns null if no division can be extracted.
 */
export function csiDivision(code: string | null | undefined): string | null {
  if (!code) return null;
  const match = code.match(/\d{2}/);
  if (!match) return null;
  return match[0];
}

/**
 * Look up the default duration for a trade by CSI code. Falls back to
 * DEFAULT_DURATION_DAYS when the division is unknown.
 */
export function defaultDurationFor(csiCode: string | null | undefined): number {
  const div = csiDivision(csiCode);
  if (!div) return DEFAULT_DURATION_DAYS;
  return DIVISION_DURATION_DAYS[div] ?? DEFAULT_DURATION_DAYS;
}

/**
 * Compare two CSI codes and return -1/0/1 based on canonical construction
 * sequence. Unknown divisions sort to the end.
 */
export function compareByDivisionOrder(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const divA = csiDivision(a);
  const divB = csiDivision(b);
  const idxA = divA ? CSI_DIVISION_SEQUENCE.indexOf(divA) : -1;
  const idxB = divB ? CSI_DIVISION_SEQUENCE.indexOf(divB) : -1;
  const rankA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
  const rankB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
  if (rankA !== rankB) return rankA - rankB;
  // Same division: fall back to full code comparison for stable ordering
  return (a ?? "").localeCompare(b ?? "");
}
