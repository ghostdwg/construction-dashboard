// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/specbook/upload/__tests__/route.test.ts
//
//  Regression coverage for the pdfjs-dist runtime crash: the route used to
//  import "pdfjs-dist/legacy/build/pdf.mjs" at module top level, which throws
//  `DOMMatrix is not defined` at import time whenever the runtime lacks a
//  DOMMatrix global (no @napi-rs/canvas, e.g. this repo's standalone Docker
//  output). That crash happened before POST() was ever bound, so every
//  upload failed regardless of the sidecar.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ── Prisma mock — enough surface for the upload route's happy + error paths ──

type SpecBookRow = { id: number; bidId: number; fileName: string; filePath: string; status: string };
type SpecSectionRow = {
  specBookId: number;
  csiNumber: string;
  csiTitle: string;
  rawText: string;
  tradeId: number | null;
  matchedTradeId: number | null;
  covered: boolean;
};

const db = {
  bidExists: true,
  trades: [{ id: 10, csiCode: "03 30 00" }] as Array<{ id: number; csiCode: string | null }>,
  bidTrades: [{ tradeId: 10 }] as Array<{ tradeId: number }>,
  specBooks: new Map<number, SpecBookRow>(),
  specBookCounter: 0,
  sections: [] as SpecSectionRow[],
};

function resetDb() {
  db.bidExists = true;
  db.specBooks.clear();
  db.specBookCounter = 0;
  db.sections = [];
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: {
      findUnique: vi.fn(async () => (db.bidExists ? { id: 1 } : null)),
    },
    trade: {
      findMany: vi.fn(async () => db.trades),
    },
    bidTrade: {
      findMany: vi.fn(async () => db.bidTrades),
    },
    specBook: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Omit<SpecBookRow, "id"> }) => {
        db.specBookCounter += 1;
        const row: SpecBookRow = { id: db.specBookCounter, ...data };
        db.specBooks.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<SpecBookRow> }) => {
        const row = db.specBooks.get(where.id);
        if (!row) throw new Error("SpecBook not found");
        Object.assign(row, data);
        return { ...row, _count: { sections: db.sections.filter((s) => s.specBookId === where.id).length } };
      }),
    },
    specSection: {
      createMany: vi.fn(async ({ data }: { data: SpecSectionRow[] }) => {
        db.sections.push(...data);
        return { count: data.length };
      }),
      count: vi.fn(async ({ where }: { where: { specBookId: number; covered: boolean } }) =>
        db.sections.filter((s) => s.specBookId === where.specBookId && s.covered === where.covered).length
      ),
    },
  },
}));

// ── AI/provider side-effect mocks — must never fire on a failed parse ───────

const generateBidIntelligenceMock = vi.fn(async () => ({ findingCount: 0, coverage: 0 }));
vi.mock("@/app/api/bids/[id]/intelligence/generate/route", () => ({
  generateBidIntelligence: generateBidIntelligenceMock,
}));

const triggerBriefRefreshMock = vi.fn(async () => undefined);
vi.mock("@/lib/services/jobs/briefRefreshAutomation", () => ({
  triggerBriefRefresh: triggerBriefRefreshMock,
}));

// ── fs/promises mock — keep the test hermetic, no real disk writes ─────────

const fsMkdirMock = vi.fn(async () => undefined);
const fsWriteFileMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { mkdir: fsMkdirMock, writeFile: fsWriteFileMock },
  mkdir: fsMkdirMock,
  writeFile: fsWriteFileMock,
}));

// ── Minimal synthetic single-page PDF, built with byte-exact xref offsets ───
// (no external fixture file exists in this repo, and pdfjs-dist ships none
// in its npm package — built in-memory so the test stays self-contained)

function buildMinimalPdf(text: string): Buffer {
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let body = header;
  const offsets: number[] = [0]; // object 0 is the free-list head
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + xref + trailer, "latin1");
}

function uploadRequest(buffer: Buffer, filename = "specbook.pdf") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], filename, { type: "application/pdf" }));
  return new Request("http://localhost/api/bids/1/specbook/upload", { method: "POST", body: form });
}

const routeParams = { params: Promise.resolve({ id: "1" }) };

describe("POST /api/bids/[id]/specbook/upload", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── A. Route-module load ──────────────────────────────────────────────────
  test("route module imports cleanly with no DOMMatrix global present", async () => {
    expect((globalThis as Record<string, unknown>).DOMMatrix).toBeUndefined();
    const mod = await import("../route");
    expect(typeof mod.POST).toBe("function");
    // The shim must not be installed at module scope — only inside the
    // fallback branch, and only when the fallback actually runs.
    expect((globalThis as Record<string, unknown>).DOMMatrix).toBeUndefined();
  });

  // ── B. Sidecar-first behavior ──────────────────────────────────────────────
  test("uses sidecar result and never needs the pdfjs-dist fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            sections: [
              { section_number: "03 30 00", title: "CAST-IN-PLACE CONCRETE", raw_text: "from sidecar", page_start: 1, page_end: 1, table_count: 0, page_count: 1 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(buildMinimalPdf("unused")), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(db.sections).toHaveLength(1);
    expect(db.sections[0].rawText).toBe("from sidecar");
    expect(json.coveredCount).toBe(1);

    // The fallback shim is only ever installed from inside parsePdfFallback —
    // it staying unset proves that path was never entered.
    expect((globalThis as Record<string, unknown>).DOMMatrix).toBeUndefined();
  });

  // ── C. Fallback behavior (success) ─────────────────────────────────────────
  test("falls back to pdfjs-dist when the sidecar is unavailable, and parses a real PDF", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8001");
    }));

    const pdf = buildMinimalPdf("03 30 00 CAST-IN-PLACE CONCRETE");
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(pdf), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(db.sections.length).toBeGreaterThan(0);
    expect(db.sections.length).toBeLessThan(50); // bounded — not a runaway parse
    expect(db.sections[0].csiNumber).toBe("03 30 00");
    expect(db.sections[0].covered).toBe(true);
    expect(json.gapCount).toBe(0);

    // Proves the dynamic import + shim path actually ran.
    expect((globalThis as Record<string, unknown>).DOMMatrix).toBeDefined();
  });

  // ── D. Controlled fallback failure ─────────────────────────────────────────
  test("returns a sanitized JSON error when both sidecar and pdfjs-dist fallback fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8001");
    }));

    const notAPdf = Buffer.from("this is not a pdf at all");
    const { POST } = await import("../route");
    const res = await POST(uploadRequest(notAPdf), routeParams);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toBe("PDF fallback parser unavailable");
    // No internal module paths, stack traces, or document bytes leaked.
    expect(json.error).not.toMatch(/pdfjs-dist|node_modules|at Object|ENOENT/i);

    // No persisted section rows, and no downstream AI/provider calls.
    expect(db.sections).toHaveLength(0);
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();

    const specBook = db.specBooks.get(db.specBookCounter);
    expect(specBook?.status).toBe("error");
  });
});
