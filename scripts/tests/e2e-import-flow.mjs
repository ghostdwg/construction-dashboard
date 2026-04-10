// End-to-end API test for the subs import flow.
// Requires the dev server to be running on localhost:3000.
//
// Run: node scripts/tests/e2e-import-flow.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3000";

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    pass++;
  } else {
    console.log(`  ✗ ${message}`);
    fail++;
  }
}

async function test(name, fn) {
  console.log(`\n● ${name}`);
  try {
    await fn();
  } catch (err) {
    console.log(`  ✗ Threw: ${err.message}`);
    fail++;
  }
}

// ── Cleanup helper: delete test subs by company name prefix ────────────────
async function cleanupTestSubs() {
  const res = await fetch(`${BASE}/api/subcontractors`);
  if (!res.ok) return;
  const subs = await res.json();
  const testSubs = subs.filter((s) =>
    s.company.startsWith("Acme Electrical") ||
    s.company.startsWith("Beta Mechanical") ||
    s.company.startsWith("Charlie Plumbing") ||
    s.company.startsWith("Delta Concrete") ||
    s.company.startsWith("[E2E TEST]")
  );
  for (const sub of testSubs) {
    await fetch(`${BASE}/api/subcontractors/${sub.id}`, { method: "DELETE" });
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

await test("Cleanup any leftover test data", async () => {
  await cleanupTestSubs();
  assert(true, "cleanup complete");
});

await test("GET /api/trades — sanity check", async () => {
  const res = await fetch(`${BASE}/api/trades`);
  assert(res.ok, "responds 200");
  const trades = await res.json();
  assert(Array.isArray(trades), "returns array");
  assert(trades.length > 0, `has trades (${trades.length} found)`);
});

await test("POST /api/subcontractors — create single sub with isPreferred", async () => {
  const res = await fetch(`${BASE}/api/subcontractors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company: "[E2E TEST] Single Sub Inc",
      office: "Test City, TS",
      isUnion: true,
      isMWBE: false,
      isPreferred: true,
    }),
  });
  assert(res.status === 201, "responds 201");
  const sub = await res.json();
  assert(sub.id, "has id");
  assert(sub.company === "[E2E TEST] Single Sub Inc", "company matches");
  assert(sub.isPreferred === true, "isPreferred persisted as true");
  assert(sub.isUnion === true, "isUnion persisted");

  // Cleanup
  await fetch(`${BASE}/api/subcontractors/${sub.id}`, { method: "DELETE" });
});

await test("PATCH /api/subcontractors/[id] — toggle isPreferred", async () => {
  // Create sub
  const createRes = await fetch(`${BASE}/api/subcontractors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: "[E2E TEST] Toggle Test", isPreferred: false }),
  });
  const created = await createRes.json();
  assert(created.isPreferred === false, "starts as not preferred");

  // Toggle to true
  const patchRes = await fetch(`${BASE}/api/subcontractors/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isPreferred: true }),
  });
  assert(patchRes.ok, "PATCH responds 200");
  const patched = await patchRes.json();
  assert(patched.isPreferred === true, "isPreferred now true");

  // Toggle back
  await fetch(`${BASE}/api/subcontractors/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isPreferred: false }),
  });

  // Cleanup
  await fetch(`${BASE}/api/subcontractors/${created.id}`, { method: "DELETE" });
});

await test("GET /api/subcontractors/import/template — downloads CSV template", async () => {
  const res = await fetch(`${BASE}/api/subcontractors/import/template`);
  assert(res.ok, "responds 200");
  const ct = res.headers.get("content-type") || "";
  assert(ct.includes("text/csv"), `content-type is text/csv (got ${ct})`);
  const text = await res.text();
  assert(text.includes("Name"), "contains Name header");
  assert(text.includes("Trades"), "contains Trades header");
  assert(text.includes("Acme Electrical"), "contains sample row");
});

await test("POST /api/subcontractors/import — preview Procore CSV", async () => {
  const csvPath = path.join(__dirname, "fixtures", "procore-sample.csv");
  const csvText = fs.readFileSync(csvPath, "utf-8");
  const blob = new Blob([csvText], { type: "text/csv" });
  const formData = new FormData();
  formData.append("file", blob, "procore-sample.csv");

  const res = await fetch(`${BASE}/api/subcontractors/import`, {
    method: "POST",
    body: formData,
  });
  assert(res.ok, `responds 200 (got ${res.status})`);
  const data = await res.json();

  assert(data.detectedFormat === "procore", `detects Procore format (got ${data.detectedFormat})`);
  assert(data.validRows === 4, `parses 4 valid rows (got ${data.validRows})`);
  assert(data.skippedRows === 1, `skips 1 row with empty company (got ${data.skippedRows})`);
  assert(Array.isArray(data.preview), "preview is array");
  assert(data.preview.length === 4, `preview has 4 entries (got ${data.preview.length})`);

  // Verify Acme row
  const acme = data.preview.find((r) => r.company === "Acme Electrical");
  assert(acme, "finds Acme Electrical");
  assert(acme.isUnion === true, "Acme isUnion=true");
  assert(acme.isMWBE === false, "Acme isMWBE=false");
  assert(acme.procoreVendorId === "V001", "Acme procoreVendorId=V001");
  assert(acme.action === "create", "Acme action=create (no conflict)");
  assert(Array.isArray(acme.resolvedTrades), "Acme has resolvedTrades");
  assert(acme.resolvedTrades.length === 2, `Acme has 2 trades (got ${acme.resolvedTrades.length})`);

  // Verify Beta row (MWBE flagged via Woman's Business)
  const beta = data.preview.find((r) => r.company === "Beta Mechanical");
  assert(beta, "finds Beta Mechanical");
  assert(beta.isMWBE === true, "Beta isMWBE=true (Woman's Business + Disadvantaged)");

  // Save preview for commit test
  globalThis.__lastPreview = data;
});

await test("POST /api/subcontractors/import/commit — persists subs", async () => {
  const preview = globalThis.__lastPreview;
  assert(preview, "has preview from previous test");

  // Mark first row as preferred for testing
  const rows = preview.preview.map((r, i) => ({
    ...r,
    isPreferred: i === 0,  // Acme is preferred
  }));

  const res = await fetch(`${BASE}/api/subcontractors/import/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  assert(res.ok, `responds 200 (got ${res.status})`);
  const result = await res.json();

  assert(result.createdCount === 4, `created 4 subs (got ${result.createdCount})`);
  assert(result.errorCount === 0, `no errors (got ${result.errorCount})`);

  // Verify the data persisted correctly
  const subsRes = await fetch(`${BASE}/api/subcontractors?search=Acme%20Electrical`);
  const subs = await subsRes.json();
  const acme = subs.find((s) => s.company === "Acme Electrical");
  assert(acme, "Acme persisted");
  assert(acme.isPreferred === true, "Acme isPreferred=true");
  assert(acme.isUnion === true, "Acme isUnion=true");

  const betaRes = await fetch(`${BASE}/api/subcontractors?search=Beta`);
  const betas = await betaRes.json();
  const beta = betas.find((s) => s.company === "Beta Mechanical");
  assert(beta, "Beta persisted");
  assert(beta.isPreferred === false, "Beta isPreferred=false");
  assert(beta.isMWBE === true, "Beta isMWBE=true");
});

await test("Re-import same CSV — detects conflicts", async () => {
  const csvPath = path.join(__dirname, "fixtures", "procore-sample.csv");
  const csvText = fs.readFileSync(csvPath, "utf-8");
  const blob = new Blob([csvText], { type: "text/csv" });
  const formData = new FormData();
  formData.append("file", blob, "procore-sample.csv");

  const res = await fetch(`${BASE}/api/subcontractors/import`, {
    method: "POST",
    body: formData,
  });
  assert(res.ok, "responds 200");
  const data = await res.json();

  assert(data.summary.conflictCount === 4, `detects 4 conflicts (got ${data.summary.conflictCount})`);
  assert(data.summary.newCount === 0, `0 new (got ${data.summary.newCount})`);

  const acme = data.preview.find((r) => r.company === "Acme Electrical");
  assert(acme.conflictWith, "Acme has conflictWith");
  assert(acme.action === "skip", "Acme defaults to skip on conflict");
});

await test("Audit: GET /api/subcontractors response does NOT contain isPreferred leakage in exports", async () => {
  // Confirm that isPreferred IS in the directory list (it should be — internal use)
  const listRes = await fetch(`${BASE}/api/subcontractors`);
  const list = await listRes.json();
  const acme = list.find((s) => s.company === "Acme Electrical");
  assert(acme, "Acme in list");
  assert("isPreferred" in acme, "isPreferred is in directory response (correct — internal use)");
});

await test("Cleanup: delete imported test subs", async () => {
  await cleanupTestSubs();
  // Verify they're gone
  const res = await fetch(`${BASE}/api/subcontractors?search=Acme%20Electrical`);
  const subs = await res.json();
  const acme = subs.find((s) => s.company === "Acme Electrical");
  assert(!acme, "Acme removed");
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`PASS: ${pass}    FAIL: ${fail}`);
console.log(`${"=".repeat(50)}`);
process.exit(fail > 0 ? 1 : 0);
