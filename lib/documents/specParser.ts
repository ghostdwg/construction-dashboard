export type SpecSectionEntry = {
  csiNumber: string;
  csiTitle: string;
  rawText: string;
};

// Matches CSI MasterFormat section headers in two forms:
//   "SECTION 03 30 00 - CAST-IN-PLACE CONCRETE"
//   "03 30 00 - CAST-IN-PLACE CONCRETE"
//   "03 30 00 CAST-IN-PLACE CONCRETE"  (no dash)
// CSI number is strictly two-digit groups: DD DD DD
const CSI_HEADER = /(?:SECTION\s+)?(\d{2}\s+\d{2}\s+\d{2})(?:\s*[-–]\s*|\s+)([A-Z][A-Za-z0-9 ,&()'/.:-]{2,80})/g;

// Normalize a CSI number to canonical "DD DD DD" form (collapses any extra whitespace)
function normalizeCsi(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

// Strip all non-digit characters for comparison — handles space, dash,
// and period separators regardless of source format.
// "03 30 00", "03-30-00", "033000" all become "033000".
function csiDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function parseSpecSections(text: string): SpecSectionEntry[] {
  // Normalize line endings so multi-line patterns are consistent
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const matches: Array<{ index: number; csiNumber: string; csiTitle: string }> = [];
  const seen = new Set<string>();

  CSI_HEADER.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CSI_HEADER.exec(normalized)) !== null) {
    const csiNumber = normalizeCsi(match[1]);
    const csiTitle = match[2].trim().replace(/\s+/g, " ");

    // Deduplicate — table of contents + body both have the header; keep first occurrence
    if (seen.has(csiNumber)) continue;
    seen.add(csiNumber);

    matches.push({ index: match.index, csiNumber, csiTitle });
  }

  return matches.map((m, i) => {
    const start = m.index;
    // Capture text up to the next section header (or 2000 chars, whichever is less)
    const end = matches[i + 1]?.index ?? start + 2000;
    const rawText = normalized.slice(start, end).trim().slice(0, 1500);

    return { csiNumber: m.csiNumber, csiTitle: m.csiTitle, rawText };
  });
}

// Exact CSI code match against a list of trades.
// Compares digit-only representations so spacing and separator
// characters don't prevent a match.
// Returns the matching tradeId or null.
export function matchSectionToTrade(
  csiNumber: string,
  trades: Array<{ id: number; csiCode: string | null }>
): number | null {
  const digits = csiDigitsOnly(csiNumber);
  if (digits.length === 0) return null;
  for (const trade of trades) {
    if (!trade.csiCode) continue;
    if (csiDigitsOnly(trade.csiCode) === digits) return trade.id;
  }
  return null;
}

// Three-state match:
//   tradeId set, matchedTradeId null  → COVERED (trade is on bid)
//   tradeId null, matchedTradeId set  → MISSING FROM BID (trade exists in dictionary, not on bid)
//   both null                         → UNKNOWN
// allTrades = full trade dictionary; bidTradeIds = Set of trade ids assigned to this bid.
export function matchSectionThreeState(
  csiNumber: string,
  allTrades: Array<{ id: number; csiCode: string | null }>,
  bidTradeIds: Set<number>
): { tradeId: number | null; matchedTradeId: number | null } {
  const digits = csiDigitsOnly(csiNumber);
  if (digits.length === 0) return { tradeId: null, matchedTradeId: null };
  for (const trade of allTrades) {
    if (!trade.csiCode) continue;
    if (csiDigitsOnly(trade.csiCode) === digits) {
      if (bidTradeIds.has(trade.id)) {
        return { tradeId: trade.id, matchedTradeId: null };
      } else {
        return { tradeId: null, matchedTradeId: trade.id };
      }
    }
  }
  return { tradeId: null, matchedTradeId: null };
}
