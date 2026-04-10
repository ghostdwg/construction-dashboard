// Procore vendor CSV parser
//
// Handles the Procore "Companies/Vendors" export format. Maps Procore column
// headers to our Subcontractor fields. Tolerates header variations and
// generic CSVs (will use whichever columns it can find).

// ── Types ──────────────────────────────────────────────────────────────────

export type ParsedVendorRow = {
  rowIndex: number;             // 1-based row number from source CSV
  company: string;              // Required
  dba?: string | null;
  office?: string | null;       // Composed from Address/City/State
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  licenseNumber?: string | null;
  trades: string[];             // Raw trade strings, comma-separated in source
  isUnion: boolean;
  isMWBE: boolean;              // True if ANY MBE/WBE/DBE/HUB/etc flag is set
  procoreVendorId?: string | null;
  rawNotes?: string | null;
  warnings: string[];           // Per-row warnings (missing required field, etc)
};

export type ParseResult = {
  rows: ParsedVendorRow[];
  totalRows: number;
  validRows: number;
  skippedRows: number;
  detectedFormat: "procore" | "generic";
  columnMap: Record<string, string>; // Header → mapped field for transparency
};

// ── Header alias map ───────────────────────────────────────────────────────
// Each canonical field maps to a list of accepted source headers (lowercase, trimmed)

const HEADER_ALIASES: Record<string, string[]> = {
  company: ["name", "company", "company name", "vendor name", "vendor"],
  dba: ["dba name", "dba", "doing business as"],
  address: ["address", "street address", "address 1", "street"],
  city: ["city"],
  state: ["state", "province", "state/province"],
  zip: ["zip", "postal code", "zip code", "postal"],
  country: ["country"],
  phone: ["business phone", "phone", "office phone", "main phone"],
  email: ["company email address", "company email", "email", "main email"],
  contactName: ["primary contact", "contact name", "contact", "first name"],
  contactEmail: ["primary contact email address", "contact email", "primary email", "default bid invitee email address"],
  contactPhone: ["mobile phone", "contact phone", "cell phone"],
  website: ["website", "url", "web"],
  licenseNumber: ["license number", "license", "lic#", "lic no"],
  trades: ["trades", "trade", "trade(s)", "specialties"],
  unionMember: ["union member", "union", "is union"],
  procoreVendorId: ["id", "vendor id", "procore id", "entity id"],
  prequalified: ["prequalified", "pre-qualified"],
};

// MWBE-style flags — any TRUE → isMWBE = true
const MWBE_FLAG_HEADERS = [
  "small business",
  "african american business",
  "asian american business",
  "hispanic business",
  "native american business",
  "woman's business",
  "womens business",
  "women's business",
  "disadvantaged business",
  "historically underutilized business",
  "minority business enterprise",
  "service-disabled veteran-owned small business",
  "8a business enterprise",
  "minority owned",
  "woman owned",
  "is mwbe",
  "mwbe",
  "dbe",
  "mbe",
  "wbe",
];

// ── CSV parsing primitive ──────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const rows: string[][] = [];
  let buffer = "";
  let inQuotes = false;

  // Handle multiline quoted fields by reassembling lines until quotes balance
  for (const line of lines) {
    if (buffer) buffer += "\n";
    buffer += line;
    const quoteCount = (buffer.match(/(?<!\\)"/g) ?? []).length;
    inQuotes = quoteCount % 2 !== 0;
    if (!inQuotes) {
      if (buffer.trim()) rows.push(parseCsvLine(buffer));
      buffer = "";
    }
  }
  if (buffer.trim()) rows.push(parseCsvLine(buffer));
  return rows;
}

// ── Header normalization ───────────────────────────────────────────────────

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
}

function mapHeaders(headers: string[]): {
  fieldToIndex: Record<string, number>;
  mwbeIndices: number[];
  columnMap: Record<string, string>;
  format: "procore" | "generic";
} {
  const normalized = headers.map(normalize);
  const fieldToIndex: Record<string, number> = {};
  const columnMap: Record<string, string> = {};
  const mwbeIndices: number[] = [];

  // Detect Procore format by signature columns
  const isProcore = normalized.includes("entity type") || normalized.includes("entity id");

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < normalized.length; i++) {
      if (aliases.includes(normalized[i])) {
        fieldToIndex[field] = i;
        columnMap[headers[i]] = field;
        break;
      }
    }
  }

  // MWBE flag column indices
  for (let i = 0; i < normalized.length; i++) {
    if (MWBE_FLAG_HEADERS.includes(normalized[i])) {
      mwbeIndices.push(i);
      columnMap[headers[i]] = "(mwbe flag)";
    }
  }

  return {
    fieldToIndex,
    mwbeIndices,
    columnMap,
    format: isProcore ? "procore" : "generic",
  };
}

// ── Bool parsing for Procore Yes/No, true/false, 1/0 ───────────────────────

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === "yes" || t === "y" || t === "true" || t === "1" || t === "x";
}

// ── Main parser ────────────────────────────────────────────────────────────

export function parseProcoreCsv(csvText: string): ParseResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return {
      rows: [],
      totalRows: 0,
      validRows: 0,
      skippedRows: 0,
      detectedFormat: "generic",
      columnMap: {},
    };
  }

  const headers = rows[0];
  const { fieldToIndex, mwbeIndices, columnMap, format } = mapHeaders(headers);

  const get = (row: string[], field: string): string | undefined => {
    const idx = fieldToIndex[field];
    if (idx === undefined) return undefined;
    return row[idx]?.trim() || undefined;
  };

  const parsed: ParsedVendorRow[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => !c?.trim())) { skipped++; continue; }

    const company = get(row, "company");
    const warnings: string[] = [];
    if (!company) {
      skipped++;
      continue;
    }

    // Trades — split comma-separated and trim
    const tradesRaw = get(row, "trades") ?? "";
    const trades = tradesRaw
      .split(/[,;|]/)
      .map((t) => t.trim())
      .filter(Boolean);

    // MWBE — true if ANY of the diversity flags is set
    let isMWBE = false;
    for (const idx of mwbeIndices) {
      if (parseBool(row[idx])) { isMWBE = true; break; }
    }

    // Compose office string from address parts
    const address = get(row, "address");
    const city = get(row, "city");
    const state = get(row, "state");
    const officeParts = [city, state].filter(Boolean);
    const office = officeParts.length > 0 ? officeParts.join(", ") : null;

    parsed.push({
      rowIndex: i + 1,
      company,
      dba: get(row, "dba") ?? null,
      office,
      address: address ?? null,
      city: city ?? null,
      state: state ?? null,
      zip: get(row, "zip") ?? null,
      country: get(row, "country") ?? null,
      phone: get(row, "phone") ?? null,
      email: get(row, "email") ?? null,
      contactName: get(row, "contactName") ?? null,
      contactEmail: get(row, "contactEmail") ?? null,
      contactPhone: get(row, "contactPhone") ?? null,
      website: get(row, "website") ?? null,
      licenseNumber: get(row, "licenseNumber") ?? null,
      trades,
      isUnion: parseBool(get(row, "unionMember")),
      isMWBE,
      procoreVendorId: get(row, "procoreVendorId") ?? null,
      rawNotes: null,
      warnings,
    });
  }

  return {
    rows: parsed,
    totalRows: rows.length - 1,
    validRows: parsed.length,
    skippedRows: skipped,
    detectedFormat: format,
    columnMap,
  };
}
