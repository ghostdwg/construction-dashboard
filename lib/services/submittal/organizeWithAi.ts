// AI Submittal Register Organizer
//
// Takes all auto-generated SubmittalItems for a bid and runs them through a
// GC-perspective Claude prompt that deduplicates, consolidates by trade,
// assigns priority + release phase, and outputs a Procore-ready register
// with PKG-[TRADE]-[SEQ] package IDs.
//
// Replaces: ai_extraction | csi_baseline | regex_seed | drawing_analysis | ai_organized
// Preserves: manual items and any packages that contain manual items

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getMaxTokens } from "@/lib/services/ai/aiTokenConfig";
import { logAiUsage, computeCallCost } from "@/lib/services/ai/aiUsageLog";

// ── GC system prompt (10-step rules) ──────────────────────────────────────

const GC_SYSTEM_PROMPT = `You are a commercial construction superintendent and project manager.

You are not a spec parser. Your role is to convert specification- and drawing-derived submittal data into a clean, deduplicated, trade-packaged submittal register suitable for import into Procore.

INPUT:
You are provided a raw submittal list generated from specifications and drawings. This list may contain duplication across CSI sections, excessive fragmentation, and spec-driven formatting that does not reflect real-world construction workflows.

OBJECTIVE:
Transform the raw list into a streamlined, construction-executable submittal register that reflects how subcontractors actually submit packages and how a GC manages submittals.

----------------------------------
STEP 1: DEDUPLICATE AND NORMALIZE
----------------------------------
- Identify duplicate or overlapping submittals across spec sections.
- Use fuzzy matching to consolidate similar items (e.g., repeated "HVAC Equipment Product Data").
- Merge duplicates into a single submittal.
- Retain all relevant spec sections as references under that one item.
- Eliminate redundant entries created solely by spec formatting.

----------------------------------
STEP 2: ORGANIZE BY TRADE (MANDATORY)
----------------------------------
Do NOT organize by spec section.

Group all submittals into the following trades:
- Site / Civil
- Concrete
- Masonry
- Metals / Structural Steel
- Building Envelope (roofing, waterproofing, insulation, windows)
- Openings (doors, frames, hardware)
- Finishes
- Fire Protection
- Plumbing
- HVAC
- Electrical

Each submittal must belong to one trade only.

----------------------------------
STEP 3: TRADE-LEVEL PACKAGING (MANDATORY)
----------------------------------
All submittals must be packaged at the TRADE level.

Rules:
- Each submittal must represent a complete package that a subcontractor would realistically submit.
- Do NOT create submittals at the individual spec section level.
- Do NOT create submittals for isolated components unless they are procured separately.
- Combine related items into logical packages.

Target per trade:
- 5–15 submittals maximum
- If a trade exceeds this range, consolidate further.

Examples:
- HVAC → Equipment Package, Ductwork Package, Controls Package, Closeout Package
- Electrical → Service & Gear Package, Lighting Package, Devices Package, Closeout Package
- Concrete → Mix Design & Reinforcing Package, Formwork Package, Closeout Package

The goal is to reflect subcontractor submittal behavior, not specification structure.

----------------------------------
STEP 4: REMOVE SPEC-DRIVEN REDUNDANCY
----------------------------------
- Do not create separate submittals for:
  - O&M manuals per spec section
  - Repeated product data across sections
  - Repeated certification language

- Consolidate:
  - O&M manuals → included in closeout package
  - Certificates → grouped under relevant package

----------------------------------
STEP 5: ASSIGN PRIORITY
----------------------------------
Assign each submittal a priority based on construction sequencing:

HIGH = Long lead or schedule critical
MEDIUM = Coordination required
LOW = Closeout or non-critical

Guidelines:

HIGH:
- Structural steel
- HVAC equipment
- Electrical gear (panels, switchgear, transformers)
- Windows / storefront / curtainwall
- Fire protection systems

MEDIUM:
- Ductwork
- Plumbing fixtures
- Doors and hardware
- Interior finishes

LOW:
- Closeout packages
- Documentation and non-critical items

----------------------------------
STEP 6: ASSIGN RELEASE PHASE
----------------------------------
Assign a release phase to each submittal:

- Preconstruction (required before procurement/fabrication)
- Early Construction (required before rough-in)
- Mid Construction (coordination dependent)
- Closeout

----------------------------------
STEP 7: SCALE TO REALISTIC GC OUTPUT
----------------------------------
- Target total submittal count: 80–150 items for a mid-size apartment project.
- If the count exceeds this range, further consolidate.
- Prioritize usability over spec completeness.

----------------------------------
STEP 8: CLOSEOUT PACKAGING (MANDATORY)
----------------------------------
For each trade, create ONE consolidated closeout submittal:

Label:
"[TRADE] Closeout Package"

Include:
- O&M Manuals
- Warranties
- As-Built Drawings
- Startup / Testing / TAB Reports (as applicable)
- Certifications (if applicable)

Rules:
- Treat each Closeout Package as a SINGLE submittal line item
- Do NOT break closeout into multiple submittals
- Infer required items based on trade scope, not just spec mentions

Assign:
- Submittal Type = O&M Manual (or Closeout if applicable)
- Priority = Low
- Release Phase = Closeout

----------------------------------
STEP 9: FINAL OUTPUT FORMAT (PROCORE READY)
----------------------------------
Output a structured table with the following fields:

- Trade
- Submittal Package Name
- Submittal Description
- Submittal Type (Shop Drawing / Product Data / Sample / O&M Manual)
- Priority (High / Medium / Low)
- Release Phase
- Spec References (all contributing sections)

----------------------------------
STEP 10: PROCORE EXPORT REQUIREMENTS WITH PACKAGE GROUPING (MANDATORY)
----------------------------------
The final output must be structured specifically for import into Procore's Submittal Register, including package grouping.

PACKAGE STRUCTURE:
- Each submittal must be assigned to a Package ID
- Package IDs must follow this format:

  PKG-[TRADE ABBREVIATION]-[SEQUENCE]

Examples:
- PKG-HVAC-01
- PKG-HVAC-02
- PKG-EL-01
- PKG-CONC-01

Rules:
- Each trade must have multiple packages (not just one), representing logical submission groupings
- Each package must group related submittals (example: HVAC Equipment, HVAC Ductwork, HVAC Controls)
- Closeout must be its own package:
  - Example: PKG-HVAC-99 (Closeout Package)

TRADE ABBREVIATIONS:
- CIV = Site / Civil
- CONC = Concrete
- MASON = Masonry
- STEEL = Metals / Structural Steel
- ENV = Building Envelope
- OPEN = Openings
- FIN = Finishes
- FIRE = Fire Protection
- PLUMB = Plumbing
- HVAC = HVAC
- ELEC = Electrical

OUTPUT REQUIREMENTS:

Each row must include:
- Package ID
- Trade
- Submittal Package Name
- Submittal Description
- Submittal Type (Shop Drawing / Product Data / Sample / O&M Manual)
- Priority (High / Medium / Low)
- Release Phase (Preconstruction / Early Construction / Mid Construction / Closeout)
- Spec References (comma-separated)

FORMATTING RULES:
- Each row = ONE submittal
- No duplicate entries
- No explanatory text outside the table
- Output must be clean and suitable for CSV/Excel import
- No merged cells or nested formatting

LOGIC RULES:
- Each Package ID must group logically related submittals
- Package numbering must be sequential within each trade (01, 02, 03…)
- Avoid over-fragmentation—packages should represent real subcontractor submission bundles
- Every submittal must be assignable in Procore without restructuring

QUALITY CHECK:
- The output must be immediately usable for Procore import
- The package structure must allow grouping, review workflows, and tracking inside Procore
- Assume no manual cleanup will occur after export

Output ONLY the markdown table. No preamble, no summary, no explanatory text.`;

// ── Types ─────────────────────────────────────────────────────────────────

type ParsedRow = {
  packageId:    string;
  trade:        string;
  packageName:  string;
  description:  string;
  submittalType: string;
  priority:     string;
  releasePhase: string;
  specRefs:     string;
};

export type OrganizeResult = {
  tradesFound:     number;
  packagesCreated: number;
  itemsCreated:    number;
  itemsRemoved:    number;
  costUsd:         number;
};

// ── Type normalizers ───────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  "shop drawing":  "SHOP_DRAWING",
  "shop drawings": "SHOP_DRAWING",
  "product data":  "PRODUCT_DATA",
  "sample":        "SAMPLE",
  "samples":       "SAMPLE",
  "mockup":        "MOCKUP",
  "mock-up":       "MOCKUP",
  "o&m manual":    "O_AND_M",
  "o&m":           "O_AND_M",
  "warranty":      "WARRANTY",
  "warranties":    "WARRANTY",
  "certificate":   "CERT",
  "certificates":  "CERT",
  "leed":          "LEED",
  "closeout":      "O_AND_M",
};

function normalizeType(raw: string): string {
  const key = raw.toLowerCase().trim();
  return TYPE_MAP[key] ?? "OTHER";
}

function normalizePriority(raw: string): string {
  const k = raw.toLowerCase().trim();
  if (k === "high")   return "HIGH";
  if (k === "medium") return "MEDIUM";
  if (k === "low")    return "LOW";
  return "MEDIUM";
}

// ── Table parser ──────────────────────────────────────────────────────────

function parseMarkdownTable(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let headerSkipped = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    // Separator row
    if (line.replace(/[\s|:-]/g, "").length === 0) continue;

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 7) continue;

    // First content row is the header
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }

    rows.push({
      packageId:    cells[0] ?? "",
      trade:        cells[1] ?? "",
      packageName:  cells[2] ?? "",
      description:  cells[3] ?? "",
      submittalType: cells[4] ?? "",
      priority:     cells[5] ?? "",
      releasePhase: cells[6] ?? "",
      specRefs:     cells[7] ?? "",
    });
  }

  return rows.filter((r) => r.packageId.startsWith("PKG-") && r.description.length > 0);
}

// ── Main export ────────────────────────────────────────────────────────────

export async function organizeSubmittalsWithAi(bidId: number): Promise<OrganizeResult> {
  const AUTO_SOURCES = ["ai_extraction", "csi_baseline", "regex_seed", "drawing_analysis", "ai_organized"];

  // 1. Load all auto-generated items with spec section context
  const items = await prisma.submittalItem.findMany({
    where:   { bidId, source: { in: AUTO_SOURCES } },
    include: { specSection: { select: { csiNumber: true, csiTitle: true } } },
    orderBy: [{ specSection: { csiNumber: "asc" } }, { title: "asc" }],
  });

  if (items.length === 0) {
    return { tradesFound: 0, packagesCreated: 0, itemsCreated: 0, itemsRemoved: 0, costUsd: 0 };
  }

  // 2. Format input table for Claude
  const header = "Spec Section | Section Title | Submittal Title | Type | Description";
  const dataLines = items.map((item) => {
    const secNum   = item.specSection?.csiNumber ?? "—";
    const secTitle = item.specSection?.csiTitle ?? "Unspecified";
    const typeLbl  = item.type ?? "OTHER";
    const desc     = (item.description ?? "").replace(/\|/g, "/");
    const title    = item.title.replace(/\|/g, "/");
    return `${secNum} | ${secTitle} | ${title} | ${typeLbl} | ${desc}`;
  });
  const inputTable = [header, ...dataLines].join("\n");

  // 3. Call Claude
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const maxTokens = await getMaxTokens("submittal-organize");

  const response = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system:     GC_SYSTEM_PROMPT,
    messages: [{
      role:    "user",
      content: `Here is the raw submittal list for this project:\n\n${inputTable}\n\nTransform this into the Procore-ready register following all 10 rules. Output ONLY the markdown table.`,
    }],
  });

  // 4. Log usage
  const usage = response.usage;
  const costUsd = computeCallCost("claude-sonnet-4-6", usage.input_tokens, usage.output_tokens);
  await logAiUsage({
    callKey:      "submittal-organize",
    model:        "claude-sonnet-4-6",
    inputTokens:  usage.input_tokens,
    outputTokens: usage.output_tokens,
    bidId,
    status: "ok",
  });

  // 5. Parse Claude's table
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const rows = parseMarkdownTable(text);

  if (rows.length === 0) {
    throw new Error(
      "Claude returned no parseable rows — check that output is a markdown table with PKG- IDs"
    );
  }

  // 6. Delete old auto-generated items
  const removed = await prisma.submittalItem.deleteMany({
    where: { bidId, source: { in: AUTO_SOURCES } },
  });

  // Delete auto-generated packages that have no manual items remaining
  const pkgsWithManualItems = await prisma.submittalPackage.findMany({
    where:  { bidId, items: { some: { source: "manual" } } },
    select: { id: true },
  });
  const protectedIds = pkgsWithManualItems.map((p) => p.id);
  await prisma.submittalPackage.deleteMany({
    where: {
      bidId,
      id: protectedIds.length > 0 ? { notIn: protectedIds } : undefined,
    },
  });

  // 7. Group rows by Package ID, create packages + items
  const packageMap = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (!packageMap.has(row.packageId)) packageMap.set(row.packageId, []);
    packageMap.get(row.packageId)!.push(row);
  }

  let packagesCreated = 0;
  let itemsCreated    = 0;

  for (const [pkgCode, pkgRows] of packageMap) {
    const firstRow = pkgRows[0];
    const pkg = await prisma.submittalPackage.create({
      data: {
        bidId,
        packageNumber: pkgCode,
        name:          firstRow.packageName,
        status:        "DRAFT",
      },
    });
    packagesCreated++;

    await prisma.submittalItem.createMany({
      data: pkgRows.map((row) => ({
        bidId,
        packageId:   pkg.id,
        title:       row.description,
        description: row.specRefs ? `Spec refs: ${row.specRefs}` : null,
        type:        normalizeType(row.submittalType),
        priority:    normalizePriority(row.priority),
        releasePhase: row.releasePhase.trim() || null,
        source:      "ai_organized",
        status:      "PENDING",
      })),
    });
    itemsCreated += pkgRows.length;
  }

  const tradesFound = new Set(rows.map((r) => r.trade)).size;

  return {
    tradesFound,
    packagesCreated,
    itemsCreated,
    itemsRemoved: removed.count,
    costUsd,
  };
}
