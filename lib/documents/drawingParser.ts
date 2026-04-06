export type DrawingSheetEntry = {
  sheetNumber: string;
  sheetTitle: string | null;
  discipline: string; // normalized uppercase: "A", "S", "M", "P", "E", "C", "FP"
};

// Matches drawing sheet numbers: A-101, S-101, M-101, P-101, E-101, C-101, FP-101
// FP must be checked before single-letter prefixes to avoid partial matches.
// Captures an optional title remainder on the same line (up to 80 chars).
const SHEET_PATTERN = /\b(FP|A|S|M|P|E|C)-(\d+(?:\.\d+)?)\b([^\n]{0,80})?/g;

// Maps CSI drawing discipline prefix to exact Trade names in the dictionary.
export const DISCIPLINE_TRADE_NAMES: Record<string, string[]> = {
  A:  [
    "Drywall",
    "Doors & Frames",
    "Flooring — Carpet",
    "Flooring — Tile",
    "Flooring — Hard Surface",
    "Painting",
    "Acoustical Ceilings",
  ],
  S:  [
    "Structural Steel",
    "Concrete — Foundations",
    "Concrete — Flatwork & Slabs",
    "Masonry — Brick",
    "Masonry — Block",
    "Rough Framing",
  ],
  M:  ["HVAC & Mechanical"],
  P:  ["Plumbing"],
  E:  ["Electrical"],
  C:  ["Site Work / Earthwork"],
  FP: ["Fire Suppression"],
};

// Returns all unique sheet entries, deduplicated by sheetNumber.
// Regex is reset before each call since it uses the global flag.
export function parseDrawingSheets(text: string): DrawingSheetEntry[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const seen = new Set<string>();
  const results: DrawingSheetEntry[] = [];

  SHEET_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SHEET_PATTERN.exec(normalized)) !== null) {
    const discipline = match[1].toUpperCase();
    const sheetNumber = `${discipline}-${match[2]}`;

    if (seen.has(sheetNumber)) continue;
    seen.add(sheetNumber);

    // Strip leading separators from the title remainder
    const rawTitle = (match[3] ?? "").trim().replace(/^[-–:.\s]+/, "").trim();
    const sheetTitle = rawTitle.length > 2 ? rawTitle : null;

    results.push({ sheetNumber, sheetTitle, discipline });
  }

  return results;
}

// Returns the first sheet number seen for each discipline.
// Used to pick a representative sheetNumber when creating per-(discipline, trade) records.
export function firstSheetByDiscipline(
  sheets: DrawingSheetEntry[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sheets) {
    if (!map.has(s.discipline)) map.set(s.discipline, s.sheetNumber);
  }
  return map;
}
