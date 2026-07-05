#!/usr/bin/env node
// scripts/specbook-staging-smoke.mjs
//
// Optional fixture/smoke helper for
// runtime/runbooks/specbook-staging-validation.md — walks the same six-step
// flow that runbook describes by hand: upload -> split -> list sections ->
// serve a section PDF -> delete -> re-upload, plus one read-only
// auth-posture check (unauthenticated request to the PDF route).
//
// SAFETY / DRY-RUN POSTURE (read before using):
//
//   - Running this script with NO arguments (or without --execute) performs
//     NO network action of any kind. It only prints the plan below and
//     exits 0. This is the default and cannot be bypassed by partial input.
//   - A real HTTP request is only ever made when ALL of the following are
//     supplied together: --base-url, --bid-id, one of --cookie/--bearer,
//     AND the --execute flag. Missing any one of these keeps the script in
//     dry-run mode.
//   - No dependency beyond what Node 18+ / this repo already provides:
//     global fetch/FormData/Blob (same primitives
//     app/api/bids/[id]/specbook/upload/route.ts already uses) and node:*
//     builtins (same as scripts/validate-staging.mjs). No package.json
//     change was made to add this script.
//   - This script never retries a failing step in a loop. Each step runs
//     once; on failure it records FAIL and moves on so the operator gets a
//     full picture in one pass (see the runbook's §5 "do not loop retries").
//   - This script never touches /specbook/analyze or /specbook/analyze/complete
//     — those depend on a working Anthropic credential (staging's known 401)
//     and are explicitly out of scope for this helper.
//   - This script was written but never executed against any real host as
//     part of producing it or the runbook it accompanies.
//
// Usage (dry run — always safe, this is the only mode used while authoring
// this script):
//
//   node scripts/specbook-staging-smoke.mjs
//   node scripts/specbook-staging-smoke.mjs --base-url https://staging.example --bid-id 123
//     (still dry-run: --execute and an auth input are both missing)
//
// Usage (real run — operator-driven, requires explicit auth input):
//
//   node scripts/specbook-staging-smoke.mjs \
//     --base-url https://staging.groundworx.neuroglitch.ai \
//     --bid-id 123 \
//     --cookie "authjs.session-token=<value>" \
//     --execute
//
//   Optional: --pdf /path/to/local/test.pdf   (defaults to a tiny synthetic
//   PDF generated in-memory with two fake CSI-style section headers — never
//   a real project document; see the runbook §5 no-secret-fixture rule).
//
// Auth note: this app's session is a NextAuth JWT cookie (lib/auth.ts), not
// a bearer token scheme for these routes. --bearer is accepted for forward
// compatibility / operator convenience but is NOT confirmed to authenticate
// against these routes today — --cookie is the realistic option. Flagged
// here as a judgment call for the operator, not asserted as supported.

import { randomUUID } from "node:crypto";

// ── Argv parsing (no dependency) ────────────────────────────────────────────

function parseArgs(argv) {
  const args = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") { args.execute = true; continue; }
    if (a === "--base-url") { args.baseUrl = argv[++i]; continue; }
    if (a === "--bid-id") { args.bidId = argv[++i]; continue; }
    if (a === "--cookie") { args.cookie = argv[++i]; continue; }
    if (a === "--bearer") { args.bearer = argv[++i]; continue; }
    if (a === "--pdf") { args.pdfPath = argv[++i]; continue; }
    if (a === "--help" || a === "-h") { args.help = true; continue; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const PLAN = `
[specbook-staging-smoke] DRY RUN — no network action taken.

This helper would perform, in order, against --base-url:

  1. POST {base}/api/bids/{bidId}/specbook/upload         (multipart: file=<test.pdf>)
  2. POST {base}/api/bids/{bidId}/specbook/split           (no body)
  3. GET  {base}/api/bids/{bidId}/specbook/gaps            (to pick a real sectionId)
  4. GET  {base}/api/bids/{bidId}/specbook/sections/{sectionId}/pdf
     4b. (auth-posture check, read-only) same URL, no auth headers, redirect not followed
  5. DELETE {base}/api/bids/{bidId}/specbook/{uploadId}    (uploadId = SpecBook.id from step 1)
  6. POST {base}/api/bids/{bidId}/specbook/upload          (re-upload, same as step 1)

Each step's exact request/response shape and pass/fail criteria are documented in:
  runtime/runbooks/specbook-staging-validation.md  (sections 2-4, 7)

To actually run this against a real staging instance, ALL of the following
must be supplied together:
  --base-url <url>       e.g. https://staging.groundworx.neuroglitch.ai
  --bid-id <n>           an existing staging Bid.id to run the flow against
  --cookie "<value>"     a valid staging session cookie header value
                         (or --bearer "<token>" — unconfirmed for these routes,
                          see this script's header comment)
  --execute              explicit confirmation to perform real HTTP requests

Optional: --pdf <path>   a local test PDF (defaults to a tiny synthetic one
                          generated in-memory — never a real project document).

Missing any of the four required inputs above keeps this script in dry-run
mode, as it is right now.
`;

const missing = [];
if (!args.baseUrl) missing.push("--base-url");
if (!args.bidId) missing.push("--bid-id");
if (!args.cookie && !args.bearer) missing.push("--cookie or --bearer");
if (!args.execute) missing.push("--execute");

if (args.help || missing.length > 0) {
  console.log(PLAN);
  if (missing.length > 0 && !args.help) {
    console.log(`[specbook-staging-smoke] Not executing — missing: ${missing.join(", ")}`);
  }
  process.exit(0);
}

// ── From here down: real-run path. Only reached when base-url, bid-id, an
// auth input, and --execute were ALL supplied explicitly. ──────────────────

const BASE_URL = args.baseUrl.replace(/\/+$/, "");
const BID_ID = args.bidId;
const RUN_TAG = `smoke-${Date.now()}-${randomUUID().slice(0, 6)}`;

function authHeaders() {
  const h = {};
  if (args.cookie) h["Cookie"] = args.cookie;
  if (args.bearer) h["Authorization"] = `Bearer ${args.bearer}`;
  return h;
}

const results = [];
function record(name, ok, detail) {
  const symbol = ok === "PASS" ? "✔" : ok === "FAIL" ? "✗" : "•";
  results.push({ name, status: ok, detail });
  console.log(`  ${symbol} ${ok.padEnd(5)} ${name}${detail ? " — " + detail : ""}`);
}

// Minimal, dependency-free single-page PDF with a couple of fake CSI-style
// section headers, so split's regex/parse logic has something to find.
// Never a real project document — synthetic fixture only.
function buildSyntheticPdf(lines) {
  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const contentLines = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${750 - i * 20} Td (${escape(line)}) Tj ET`)
    .join("\n");
  const content = `${contentLines}\n`;

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
  );
  objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}endstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

async function loadTestPdf() {
  if (args.pdfPath) {
    const { readFile } = await import("node:fs/promises");
    return await readFile(args.pdfPath);
  }
  return buildSyntheticPdf([
    "SECTION 09 91 00 - PAINTING",
    "This section covers field-applied paint systems.",
    "SECTION 26 05 00 - ELECTRICAL",
    "This section covers basic electrical materials and methods.",
  ]);
}

async function uploadStep(label, pdfBuffer) {
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      `smoke-test-${RUN_TAG}.pdf`
    );
    const res = await fetch(`${BASE_URL}/api/bids/${BID_ID}/specbook/upload`, {
      method: "POST",
      body: form,
      headers: authHeaders(),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 201) {
      record(label, "FAIL", `status=${res.status} body=${JSON.stringify(body)}`);
      return null;
    }
    record(label, "PASS", `status=${res.status} specBookId=${body?.id} sections=${body?._count?.sections}`);
    return body;
  } catch (err) {
    record(label, "FAIL", err.message);
    return null;
  }
}

async function splitStep() {
  try {
    const res = await fetch(`${BASE_URL}/api/bids/${BID_ID}/specbook/split`, {
      method: "POST",
      headers: authHeaders(),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 200) {
      record("2. split", "FAIL", `status=${res.status} body=${JSON.stringify(body)}`);
      return null;
    }
    record("2. split", "PASS", `sectionsCreated=${body?.sectionsCreated}`);
    return body;
  } catch (err) {
    record("2. split", "FAIL", err.message);
    return null;
  }
}

async function listSectionsStep() {
  try {
    const res = await fetch(`${BASE_URL}/api/bids/${BID_ID}/specbook/gaps`, {
      headers: authHeaders(),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 200 || !body) {
      record("3. list sections", "FAIL", `status=${res.status}`);
      return null;
    }
    // Response shape per app/api/bids/[id]/specbook/gaps/route.ts:
    // { specBook, total, coveredCount, missingCount, unknownCount,
    //   covered: [...], missing: [...], unknown: [...], aiAnalysis }
    const allSections = [
      ...(body.covered ?? []),
      ...(body.missing ?? []),
      ...(body.unknown ?? []),
    ];
    if (allSections.length === 0) {
      record("3. list sections", "FAIL", "no sections returned");
      return null;
    }
    record("3. list sections", "PASS", `sectionId=${allSections[0].id}`);
    return allSections[0].id;
  } catch (err) {
    record("3. list sections", "FAIL", err.message);
    return null;
  }
}

async function servePdfStep(sectionId) {
  try {
    const res = await fetch(
      `${BASE_URL}/api/bids/${BID_ID}/specbook/sections/${sectionId}/pdf`,
      { headers: authHeaders() }
    );
    const contentType = res.headers.get("content-type") || "";
    if (res.status !== 200 || !contentType.includes("application/pdf")) {
      const body = await res.text().catch(() => "");
      record("4. serve pdf", "FAIL", `status=${res.status} content-type=${contentType} body=${body.slice(0, 200)}`);
      return false;
    }
    record("4. serve pdf", "PASS", `status=${res.status} content-type=${contentType}`);
    return true;
  } catch (err) {
    record("4. serve pdf", "FAIL", err.message);
    return false;
  }
}

async function authPostureCheck(sectionId) {
  try {
    const res = await fetch(
      `${BASE_URL}/api/bids/${BID_ID}/specbook/sections/${sectionId}/pdf`,
      { redirect: "manual" } // no auth headers on purpose
    );
    const isRedirectish = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location") || "";
    if (isRedirectish && location.includes("/login")) {
      record("4b. auth-posture (unauthenticated)", "PASS", `status=${res.status} location includes /login`);
    } else if (res.status === 200) {
      record("4b. auth-posture (unauthenticated)", "FAIL", "got 200 without auth — served without a session");
    } else {
      record("4b. auth-posture (unauthenticated)", "FAIL", `status=${res.status} location=${location || "(none)"}`);
    }
  } catch (err) {
    record("4b. auth-posture (unauthenticated)", "FAIL", err.message);
  }
}

async function deleteStep(specBookId) {
  try {
    const res = await fetch(`${BASE_URL}/api/bids/${BID_ID}/specbook/${specBookId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status !== 204) {
      record("5. delete", "FAIL", `status=${res.status}`);
      return false;
    }
    record("5. delete", "PASS", `status=${res.status}`);
    return true;
  } catch (err) {
    record("5. delete", "FAIL", err.message);
    return false;
  }
}

async function confirmDeletedStep() {
  try {
    const res = await fetch(`${BASE_URL}/api/bids/${BID_ID}/specbook/gaps`, {
      headers: authHeaders(),
    });
    const body = await res.json().catch(() => undefined);
    if (body === null) {
      record("5b. confirm deleted", "PASS", "gaps now returns null");
    } else {
      record("5b. confirm deleted", "FAIL", `gaps still returns a spec book: ${JSON.stringify(body).slice(0, 120)}`);
    }
  } catch (err) {
    record("5b. confirm deleted", "FAIL", err.message);
  }
}

// ── Main (real-run path) ────────────────────────────────────────────────────

console.log("[specbook-staging-smoke] EXECUTING against a real host — this is not a dry run.");
console.log(`  RUN_TAG=${RUN_TAG}`);
console.log(`  BASE_URL=${BASE_URL}`);
console.log(`  BID_ID=${BID_ID}`);
console.log(`  auth=${args.cookie ? "cookie (redacted)" : "bearer (redacted, unconfirmed for these routes)"}`);
console.log("");

const pdf = await loadTestPdf();

const first = await uploadStep("1. upload", pdf);
if (first) {
  const split = await splitStep();
  if (split) {
    const sectionId = await listSectionsStep();
    if (sectionId != null) {
      await servePdfStep(sectionId);
      await authPostureCheck(sectionId);
    }
  }
  const deleted = await deleteStep(first.id);
  if (deleted) await confirmDeletedStep();
  // Step 6: re-upload, same fixture. Only meaningful evidence is a fresh
  // SpecBook.id distinct from `first.id` (see runbook §2.6 / §4).
  const second = await uploadStep("6. re-upload", pdf);
  if (second && first) {
    if (second.id !== first.id) {
      record("6b. fresh SpecBook.id", "PASS", `${first.id} -> ${second.id}`);
    } else {
      record("6b. fresh SpecBook.id", "FAIL", `id unchanged: ${second.id}`);
    }
  }
}

console.log("");
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
console.log("===============================================================");
console.log(`  SPEC BOOK SMOKE — ${pass} pass · ${fail} fail`);
console.log("===============================================================");
console.log("Reminder: this run did NOT touch /specbook/analyze — AI analysis");
console.log("content remains unprovable while staging's Anthropic 401 stands.");
console.log("See runtime/runbooks/specbook-staging-validation.md §6.");

process.exit(fail > 0 ? 1 : 0);
