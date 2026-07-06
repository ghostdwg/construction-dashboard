#!/usr/bin/env node
// scripts/artifacts-staging-smoke.mjs
//
// Operator-plane smoke helper covering three upload-artifact lifecycles —
// Drawings, Addendums, and Estimates — modeled directly on
// scripts/specbook-staging-smoke.mjs (read that file's header first; this
// script mirrors its safety posture line for line and only differs where a
// route surface actually differs). One parameterized script (--domain) is
// used instead of three separate files because the shared plumbing (argv
// parsing, cookie prompt, preflight, staging-substring check, refusal
// matrix) is identical across domains — only the per-domain route shapes
// and cleanup story differ, and those differences are isolated below in
// DOMAIN_CONFIG.
//
// SAFETY / DRY-RUN POSTURE (read before using) — IDENTICAL to
// specbook-staging-smoke.mjs:
//
//   - Running this script with NO arguments (or without --execute) performs
//     NO network action of any kind. It only prints the plan(s) below and
//     exits 0. This is the default and cannot be bypassed by partial input.
//   - A real HTTP request is only ever made when ALL of the following are
//     supplied together: --domain, --base-url, --bid-id (+ any domain-
//     specific required id, see below), an auth input, --execute, AND
//     --storage-only. Missing any one of these keeps the script in dry-run
//     mode. In --execute --storage-only mode specifically, the ONLY
//     accepted auth input is --cookie-prompt — passing --cookie or --bearer
//     directly alongside --execute --storage-only is a hard refusal, not
//     just discouraged.
//   - No dependency beyond what Node 18+ / this repo already provides:
//     global fetch/FormData/Blob and node:* builtins, including the
//     --cookie-prompt hidden-input mechanism, built directly on
//     process.stdin raw-mode handling — no readline "password" package, no
//     third-party prompt library, no package.json change.
//   - This script never retries a failing step in a loop. Each step runs
//     once; on failure it records FAIL and moves on so the operator gets a
//     full picture in one pass.
//   - This script was written but never executed against any real host as
//     part of producing it.
//
// WHY --storage-only IS REQUIRED FOR EVERY DOMAIN, EVEN THOUGH NOT EVERY
// ROUTE HAS A SUPPRESSION GATE:
//
//   Per GWX-Q06a's audit (see the per-route findings in this script's
//   accompanying commit message), the Drawings UPLOAD route
//   (app/api/bids/[id]/drawings/upload/route.ts) and — per the captain's
//   cross-track ruling extending GWX-Q06a — the Addendums DELETE route
//   (app/api/bids/[id]/addendums/[addendumId]/route.ts) fire provider-bound
//   automation and therefore carry the 4-condition suppression gate. The
//   Addendums and Estimates UPLOAD routes were confirmed clean (they fire
//   no generateBidIntelligence/triggerBriefRefresh call at all from their
//   POST handlers). --storage-only is required uniformly across all three
//   domains here: it is this script's single, consistent confirmation that
//   the operator understands "this is a mechanics-only validation run" and
//   forces every domain through the same --cookie-prompt-only auth path.
//   Each marker header is sent ONLY to its own gated route (drawings:
//   upload; addendums: cleanup delete) — never to ungated routes. See each
//   domain's DOMAIN_CONFIG entry below.
//
// PER-DOMAIN ROUTE SURFACES (verified against the actual route files, never
// invented — see each domain's config below for the exact paths):
//
//   DRAWINGS   upload -> list (read) -> delete (self-cleanup)
//     - POST   /api/bids/{bidId}/drawings/upload         (gated — see below)
//     - GET    /api/bids/{bidId}/drawings/gaps            (read-only list)
//     - DELETE /api/bids/{bidId}/drawings/{uploadId}      (204 — self-cleanup)
//     - Gated: app/api/bids/[id]/drawings/upload/route.ts fires
//       generateBidIntelligence + triggerBriefRefresh from TWO call sites
//       (both gated by GWX-Q06a). This script sends the marker header
//       (X-Drawings-Storage-Smoke: 1) and asserts automationStatus ===
//       "suppressed_for_storage_smoke" on the upload response.
//
//   ADDENDUMS  upload -> list (read) -> delete (self-cleanup, GATED)
//     - POST   /api/bids/{bidId}/addendums/upload         (NOT gated — clean)
//     - GET    /api/bids/{bidId}/addendums                (read-only list)
//     - DELETE /api/bids/{bidId}/addendums/{addendumId}   (200 { deleted:
//                                                           true } —
//                                                           self-cleanup,
//                                                           GATED)
//     - Confirmed clean: app/api/bids/[id]/addendums/upload/route.ts's POST
//       handler fires NO generateBidIntelligence/triggerBriefRefresh call at
//       all — no gate exists there (nothing to gate) and no marker header is
//       sent on the upload.
//     - The DELETE route used for this domain's self-cleanup
//       (app/api/bids/[id]/addendums/[addendumId]/route.ts) unconditionally
//       fired triggerBriefRefresh(bidId, ...) — a real Claude-calling job —
//       which would have made this script's own cleanup step fire a real
//       provider call as a side effect. Per the captain's cross-track
//       ruling extending GWX-Q06a, that route now carries the same
//       4-condition suppression gate as the upload gates (marker header
//       X-Addendums-Storage-Smoke + STORAGE_SMOKE_MODE_ENABLED=true +
//       APP_ENV=staging + admin session). Because its success body is a
//       fixed { deleted: true } shape, suppression is signaled via an
//       ADDITIVE response header: X-Automation-Status:
//       suppressed_for_storage_smoke (set ONLY when suppressed — the
//       default path's response stays byte-identical). This script's
//       cleanup step sends the marker header and FAILS LOUDLY if that
//       response header is missing or has any other value — that would mean
//       suppression did not engage and a real provider call may have just
//       fired.
//
//   ESTIMATES  upload -> list (read) -> NO DELETE ENDPOINT EXISTS
//     - POST   /api/bids/{bidId}/estimates                (NOT gated — clean)
//     - GET    /api/bids/{bidId}/estimates                (read-only list,
//                                                           pricingData
//                                                           already stripped
//                                                           server-side)
//     - Confirmed clean: app/api/bids/[id]/estimates/route.ts's POST
//       handler fires NO generateBidIntelligence/triggerBriefRefresh call.
//     - NO DELETE ROUTE EXISTS FOR EstimateUpload ANYWHERE IN THIS APP (grep
//       confirms no estimateUpload.delete/deleteMany call site outside this
//       route file's own upsert `update` branch, and no
//       app/api/bids/[id]/estimates/[estimateId]/route.ts exists at all —
//       only .../sanitize/route.ts does). Per this script's own "never
//       invent endpoints" rule, NO delete call is made for this domain —
//       true self-cleanup is IMPOSSIBLE via the API today. Instead: the
//       POST handler is an upsert keyed on (bidId, subcontractorId), so
//       re-running this script against the SAME designated smoke
//       subcontractorId overwrites the same EstimateUpload row rather than
//       creating a new one each run — this bounds growth to exactly one
//       residual row per (bidId, subcontractorId) pair, but it is NOT
//       cleanup: that row remains in staging's DB after every run. This
//       script prints an unmissable, un-suppressible warning to that effect
//       every time the estimates domain is exercised in --execute mode; see
//       cleanupDeleteStep() below (it is a no-op SKIP for this domain, not a
//       real delete). Requires an additional --subcontractor-id argument (a
//       real Subcontractor.id on the target host — never invented/
//       auto-created by this script).
//
// SECURE COOKIE PROMPT / --base-url tightening / PREFLIGHT BID CHECK:
// identical mechanics and rationale to specbook-staging-smoke.mjs — see
// that file's header comment for the full write-up. Not re-derived here to
// avoid drift between two copies of the same prose; only behavior that
// differs by domain is documented above.
//
// Usage (dry run — always safe):
//
//   node scripts/artifacts-staging-smoke.mjs
//   node scripts/artifacts-staging-smoke.mjs --domain drawings --base-url https://staging.example --bid-id 123
//     (still dry-run: --execute, --storage-only, and an auth input are all missing)
//
// Usage (real run — operator-driven, storage-only, interactive terminal,
// --cookie-prompt required). Run this LOCALLY, in your own terminal:
//
//   node scripts/artifacts-staging-smoke.mjs \
//     --domain drawings \
//     --base-url https://staging.groundworx.neuroglitch.ai \
//     --bid-id 123 \
//     --cookie-prompt --execute --storage-only
//
//   node scripts/artifacts-staging-smoke.mjs \
//     --domain addendums \
//     --base-url https://staging.groundworx.neuroglitch.ai \
//     --bid-id 123 \
//     --cookie-prompt --execute --storage-only
//
//   node scripts/artifacts-staging-smoke.mjs \
//     --domain estimates \
//     --base-url https://staging.groundworx.neuroglitch.ai \
//     --bid-id 123 --subcontractor-id 45 \
//     --cookie-prompt --execute --storage-only
//
// TESTABILITY: parseArgs(), runMain(), and promptForCookie() are exported so
// scripts/__tests__/artifacts-staging-smoke.test.ts can drive both the
// dry-run and refusal paths in-process, without spawning a real child
// process or touching a real host — same convention as
// specbook-staging-smoke.mjs.

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const REQUIRED_AUTOMATION_STATUS = "suppressed_for_storage_smoke";
const DOMAINS = ["drawings", "addendums", "estimates"];

// ── Per-domain route configuration — every path below was read directly out
// of the actual route file, never guessed. Marker headers are per-REQUEST,
// not per-domain: each is sent only to the specific gated route it belongs
// to (uploadMarkerHeader on the upload POST, cleanupMarkerHeader on the
// cleanup DELETE), never to ungated routes. ─────────────────────────────────
const DOMAIN_CONFIG = {
  drawings: {
    label: "Drawings",
    uploadMarkerHeader: "X-Drawings-Storage-Smoke", // upload route is gated
    cleanupMarkerHeader: null, // drawings DELETE fires no automation — no gate, no marker
    uploadPath: (bidId) => `/api/bids/${bidId}/drawings/upload`,
    listPath: (bidId) => `/api/bids/${bidId}/drawings/gaps`,
    deletePath: (bidId, artifactId) => `/api/bids/${bidId}/drawings/${artifactId}`,
    deleteExpectedStatus: 204,
    supportsCleanup: true,
  },
  addendums: {
    label: "Addendums",
    uploadMarkerHeader: null, // upload route confirmed clean — no gate, no marker
    cleanupMarkerHeader: "X-Addendums-Storage-Smoke", // DELETE route is gated (captain's ruling)
    uploadPath: (bidId) => `/api/bids/${bidId}/addendums/upload`,
    listPath: (bidId) => `/api/bids/${bidId}/addendums`,
    deletePath: (bidId, artifactId) => `/api/bids/${bidId}/addendums/${artifactId}`,
    deleteExpectedStatus: 200,
    supportsCleanup: true,
  },
  estimates: {
    label: "Estimates",
    uploadMarkerHeader: null, // upload route confirmed clean — no gate, no marker
    cleanupMarkerHeader: null,
    uploadPath: (bidId) => `/api/bids/${bidId}/estimates`,
    listPath: (bidId) => `/api/bids/${bidId}/estimates`,
    deletePath: null, // NO delete route exists anywhere in this app — verified, never invented.
    deleteExpectedStatus: null,
    supportsCleanup: false,
    requiresSubcontractorId: true,
    noCleanupWarning:
      "NO DELETE ENDPOINT EXISTS for EstimateUpload anywhere in this app (verified — not invented). " +
      "True self-cleanup is IMPOSSIBLE via the API today. This upload is an upsert keyed on " +
      "(bidId, subcontractorId): re-running this script against the SAME --subcontractor-id overwrites " +
      "the same row instead of creating a new one, but a residual EstimateUpload row REMAINS in " +
      "staging's DB after every run of this domain. There is no way around this without a product " +
      "change (adding a DELETE route) — out of scope for this script.",
  },
};

// ── Argv parsing (no dependency, pure) ──────────────────────────────────────

export function parseArgs(argv) {
  const args = { execute: false, storageOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") { args.execute = true; continue; }
    if (a === "--storage-only") { args.storageOnly = true; continue; }
    if (a === "--domain") { args.domain = argv[++i]; continue; }
    if (a === "--base-url") { args.baseUrl = argv[++i]; continue; }
    if (a === "--bid-id") { args.bidId = argv[++i]; continue; }
    if (a === "--subcontractor-id") { args.subcontractorId = argv[++i]; continue; }
    if (a === "--cookie") { args.cookie = argv[++i]; continue; }
    if (a === "--bearer") { args.bearer = argv[++i]; continue; }
    if (a === "--cookie-prompt") { args.cookiePrompt = true; continue; }
    if (a === "--file") { args.filePath = argv[++i]; continue; }
    if (a === "--help" || a === "-h") { args.help = true; continue; }
  }
  return args;
}

// Minimal, dependency-free shape check for a `--cookie-prompt`-collected
// value — identical to specbook-staging-smoke.mjs's looksLikeCookiePair().
export function looksLikeCookiePair(value) {
  if (typeof value !== "string") return false;
  const eq = value.indexOf("=");
  if (eq <= 0) return false;
  const name = value.slice(0, eq);
  const val = value.slice(eq + 1);
  return name.length > 0 && val.length > 0;
}

function planFor(domain) {
  const cfg = DOMAIN_CONFIG[domain];
  const lines = [`  [${cfg.label}]`];
  lines.push(`    0. GET  {base}/api/bids/{bidId}                (read-only preflight)`);
  lines.push(
    `    1. POST {base}${cfg.uploadPath("{bidId}")}${cfg.requiresSubcontractorId ? "  (multipart: file, subcontractorId=--subcontractor-id)" : "  (multipart: file" + (domain === "addendums" ? ", addendumNumber" : "") + ")"}`
  );
  if (cfg.uploadMarkerHeader) {
    lines.push(`       (sends ${cfg.uploadMarkerHeader}: 1 — GATED route, asserts automationStatus="${REQUIRED_AUTOMATION_STATUS}")`);
  } else {
    lines.push(`       (no marker header — this route fires no provider-bound automation, confirmed by GWX-Q06a's audit)`);
  }
  lines.push(`    2. GET  {base}${cfg.listPath("{bidId}")}                (read-only list)`);
  if (cfg.supportsCleanup) {
    lines.push(`    3. DELETE {base}${cfg.deletePath("{bidId}", "{artifactId}")}  (self-cleanup of THIS run's own artifact)`);
    if (cfg.cleanupMarkerHeader) {
      lines.push(
        `       (sends ${cfg.cleanupMarkerHeader}: 1 — GATED route, asserts response header X-Automation-Status="${REQUIRED_AUTOMATION_STATUS}")`
      );
    }
  } else {
    lines.push(`    3. (none — ${cfg.noCleanupWarning})`);
  }
  return lines.join("\n");
}

function fullPlan() {
  return `
[artifacts-staging-smoke] DRY RUN — no network action taken.

This helper covers three independent upload-artifact lifecycles. Pass
--domain <drawings|addendums|estimates> to select one for a real run; this
dry-run view shows the plan for all three.

${DOMAINS.map(planFor).join("\n\n")}

To actually run this against a real staging instance, ALL of the following
must be supplied together:
  --domain <drawings|addendums|estimates>
  --base-url <url>       must contain "staging" (case-insensitive)
  --bid-id <n>           an existing staging Bid.id to run the flow against
  --subcontractor-id <n> REQUIRED for --domain estimates only — a real
                         staging Subcontractor.id (never invented/created
                          by this script)
  --cookie-prompt        REQUIRED (in place of --cookie/--bearer) —
                         interactively prompts for the session cookie with
                          echo disabled. Requires an interactive TTY.
                          Passing --cookie or --bearer directly alongside
                          --execute --storage-only is REJECTED.
  --execute              explicit confirmation to perform real HTTP requests
  --storage-only         explicit confirmation this is a storage-only run —
                         REQUIRED for every domain (see this script's header
                          comment for why this is required even for domains
                          with no suppression gate).

Optional: --file <path>  a local test file (defaults to a tiny synthetic PDF
                          generated in-memory — never a real project
                          document).

Missing any of the required inputs above keeps this script in dry-run mode.
This is NOT a real-AI validation tool — it proves storage/DB mechanics only.
`;
}

// Minimal, dependency-free single-page synthetic PDF — same builder shape as
// specbook-staging-smoke.mjs's buildSyntheticPdf(), simplified since no
// section-header parsing is exercised by any of these three domains' smoke
// flows. Never a real project document.
function buildSyntheticPdf(tag) {
  const content = `BT /F1 12 Tf 72 720 Td (artifacts-staging-smoke ${tag}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
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

async function loadTestFile(filePath, tag) {
  if (filePath) {
    const { readFile } = await import("node:fs/promises");
    return await readFile(filePath);
  }
  return buildSyntheticPdf(tag);
}

// ── Secure interactive cookie prompt — identical mechanism to
// specbook-staging-smoke.mjs's promptForCookie(); see that file's header for
// the full rationale (no built-in hidden-input primitive in Node; raw-mode
// stdin handling with no dependency).
export function promptForCookie(streams = {}) {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? process.stdout;

  return new Promise((resolvePromise, reject) => {
    if (!stdin.isTTY || !stdout.isTTY) {
      reject(new Error("--cookie-prompt requires an interactive TTY; refusing to read from stdin."));
      return;
    }

    stdout.write(
      "[artifacts-staging-smoke] Enter the staging session cookie value (input hidden, press Enter when done): "
    );

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk) => {
      const text = chunk.toString();
      for (const ch of text) {
        if (ch === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cookie entry aborted (Ctrl-C)."));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          stdout.write("\n");
          resolvePromise(value);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };

    stdin.on("data", onData);
  });
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function runMain(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const storageOnlyExecute = args.execute && args.storageOnly;

  const missing = [];
  if (!args.domain) {
    missing.push("--domain <drawings|addendums|estimates>");
  } else if (!DOMAINS.includes(args.domain)) {
    missing.push(`--domain must be one of: ${DOMAINS.join(", ")}`);
  }
  if (!args.baseUrl) {
    missing.push("--base-url");
  } else if (args.execute && !/staging/i.test(args.baseUrl)) {
    missing.push('--base-url must reference a staging host (contain "staging") for any real run');
  }
  if (!args.bidId) missing.push("--bid-id");

  const cfg = args.domain && DOMAINS.includes(args.domain) ? DOMAIN_CONFIG[args.domain] : null;
  if (cfg?.requiresSubcontractorId && !args.subcontractorId) {
    missing.push("--subcontractor-id (required for --domain estimates)");
  }

  if (storageOnlyExecute) {
    if (args.cookie) {
      missing.push(
        "Passing --cookie directly is not permitted in storage-only execute mode — use --cookie-prompt instead. Refusing."
      );
    }
    if (args.bearer) {
      missing.push(
        "Passing --bearer directly is not permitted in storage-only execute mode — use --cookie-prompt instead. Refusing."
      );
    }
    if (!args.cookiePrompt) {
      missing.push("--cookie-prompt (required in --execute --storage-only mode)");
    } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
      missing.push(
        "--cookie-prompt requires an interactive terminal (process.stdin/process.stdout must both be a TTY) — refusing to prompt in a non-interactive environment"
      );
    }
  } else {
    if (!args.cookie && !args.bearer) missing.push("--cookie or --bearer");
  }

  if (!args.execute) missing.push("--execute");
  if (args.execute && !args.storageOnly) {
    missing.push("--storage-only (required for every domain — see this script's header comment)");
  }

  if (args.help || missing.length > 0) {
    console.log(fullPlan());
    if (missing.length > 0 && !args.help) {
      console.log(`[artifacts-staging-smoke] Not executing — missing/invalid: ${missing.join(", ")}`);
    }
    process.exit(0);
    return;
  }

  // ── From here down: real-run path for the SELECTED domain only. ──────────

  const BASE_URL = args.baseUrl.replace(/\/+$/, "");
  const BID_ID = args.bidId;
  const RUN_TAG = `smoke-${Date.now()}-${randomUUID().slice(0, 6)}`;

  let sessionCookieValue = null;

  // Base auth headers only — marker headers are added per-request by the
  // step that talks to a gated route (uploadStep / cleanupDeleteStep), so
  // each marker is sent ONLY to its own gated route and never to ungated
  // ones.
  function authHeaders(extra = {}) {
    const h = {};
    if (storageOnlyExecute) {
      if (sessionCookieValue) h["Cookie"] = sessionCookieValue;
    } else {
      if (args.cookie) h["Cookie"] = args.cookie;
      if (args.bearer) h["Authorization"] = `Bearer ${args.bearer}`;
    }
    return { ...h, ...extra };
  }

  // Marker for a specific gated route — only ever non-empty in storage-only
  // execute mode (we are already past the missing-inputs gate, so
  // args.storageOnly is always true here in practice; the explicit check is
  // defense-in-depth against future refactors).
  function markerFor(headerName) {
    if (!headerName) return {};
    if (!(args.execute && args.storageOnly)) return {};
    return { [headerName]: "1" };
  }

  const results = [];
  function record(name, ok, detail) {
    const symbol = ok === "PASS" ? "✔" : ok === "FAIL" ? "✗" : "•";
    results.push({ name, status: ok, detail });
    console.log(`  ${symbol} ${ok.padEnd(5)} ${name}${detail ? " — " + detail : ""}`);
  }

  // Upload-gate assertion (drawings): the gated upload route signals via a
  // body field. Fail loudly if suppression did not engage.
  function assertAutomationSuppressed(label, body) {
    if (!cfg.uploadMarkerHeader) return;
    if (!args.storageOnly) return;
    const status = body?.automationStatus;
    if (status === REQUIRED_AUTOMATION_STATUS) {
      record(label, "PASS", `automationStatus=${status}`);
    } else {
      record(
        label,
        "FAIL",
        `expected automationStatus="${REQUIRED_AUTOMATION_STATUS}", got ${JSON.stringify(status)} — ` +
          "suppression did NOT engage; a real provider call may have just fired"
      );
    }
  }

  // Cleanup-gate assertion (addendums): the gated DELETE route signals via
  // an additive response HEADER (its success body is a fixed shape). Fail
  // loudly if suppression did not engage — that would mean the delete just
  // fired a real, provider-bound triggerBriefRefresh.
  function assertCleanupAutomationSuppressed(res) {
    if (!cfg.cleanupMarkerHeader) return;
    if (!args.storageOnly) return;
    const headerValue = res.headers.get("x-automation-status");
    if (headerValue === REQUIRED_AUTOMATION_STATUS) {
      record("3b. cleanup automation suppressed", "PASS", `X-Automation-Status=${headerValue}`);
    } else {
      record(
        "3b. cleanup automation suppressed",
        "FAIL",
        `expected response header X-Automation-Status="${REQUIRED_AUTOMATION_STATUS}", got ${JSON.stringify(headerValue)} — ` +
          "suppression did NOT engage on the cleanup delete; a real provider call may have just fired"
      );
    }
  }

  async function preflightBidStep() {
    try {
      const res = await fetch(`${BASE_URL}/api/bids/${BID_ID}`, {
        headers: authHeaders(),
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        record("0. preflight bid check", "FAIL", `status=${res.status} — redirected (likely a bad/expired session)`);
        return false;
      }
      if (res.status === 404) {
        record("0. preflight bid check", "FAIL", `status=404 — Bid.id=${BID_ID} does not exist on this host`);
        return false;
      }
      if (res.status !== 200) {
        record("0. preflight bid check", "FAIL", `status=${res.status}`);
        return false;
      }

      const appEnvHeader = res.headers.get("x-app-env");
      if (appEnvHeader !== "staging") {
        record(
          "0. preflight bid check",
          "FAIL",
          `X-App-Env=${appEnvHeader ? JSON.stringify(appEnvHeader) : "(missing)"} (expected "staging")`
        );
        return false;
      }

      const body = await res.json().catch(() => null);
      if (!body || typeof body.id !== "number" || body.id !== Number(BID_ID)) {
        record("0. preflight bid check", "FAIL", "response was not JSON-shaped like the expected Bid");
        return false;
      }

      record("0. preflight bid check", "PASS", "bid confirmed to exist on a staging host with a valid session");
      return true;
    } catch (err) {
      record("0. preflight bid check", "FAIL", err.message);
      return false;
    }
  }

  async function uploadStep(buffer) {
    try {
      const form = new FormData();
      const fileName = `smoke-test-${RUN_TAG}.pdf`;
      form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), fileName);
      if (args.domain === "addendums") {
        // addendumNumber has no unique constraint in this schema — any
        // positive integer is accepted; derived from the run tag so
        // concurrent runs don't visibly collide (not that collision would
        // break anything — it's just cosmetic).
        form.append("addendumNumber", String((Date.now() % 100000) + 1));
      }
      if (args.domain === "estimates") {
        form.append("subcontractorId", String(args.subcontractorId));
      }

      const res = await fetch(`${BASE_URL}${cfg.uploadPath(BID_ID)}`, {
        method: "POST",
        body: form,
        headers: authHeaders(markerFor(cfg.uploadMarkerHeader)),
        redirect: "manual",
      });
      const body = await res.json().catch(() => null);
      if (res.status !== 201) {
        record(
          "1. upload",
          "FAIL",
          `status=${res.status} error=${typeof body?.error === "string" ? body.error : "(no error message in response)"}`
        );
        return null;
      }
      // Never print the created artifact's id or any other response field
      // (requirement 5/6 audit) — only a safe, generic acknowledgment.
      record("1. upload", "PASS", `status=${res.status} created=true`);
      return body;
    } catch (err) {
      record("1. upload", "FAIL", err.message);
      return null;
    }
  }

  async function listStep() {
    try {
      const res = await fetch(`${BASE_URL}${cfg.listPath(BID_ID)}`, {
        headers: authHeaders(),
        redirect: "manual",
      });
      if (res.status !== 200) {
        record("2. list/availability read", "FAIL", `status=${res.status}`);
        return false;
      }
      // Never print the response body itself — only confirm it parsed as
      // JSON (list or null shape, depending on domain).
      const body = await res.json().catch(() => undefined);
      if (body === undefined) {
        record("2. list/availability read", "FAIL", "response was not valid JSON");
        return false;
      }
      record("2. list/availability read", "PASS", `status=${res.status}`);
      return true;
    } catch (err) {
      record("2. list/availability read", "FAIL", err.message);
      return false;
    }
  }

  // Self-cleanup — ONLY ever targets the id this run's own uploadStep()
  // returned (never guessed, never a pre-existing artifact). Never throws;
  // a network/fetch failure is caught and recorded as FAIL so a cleanup
  // failure can never crash the script or mask an earlier result.
  async function cleanupDeleteStep(artifactId) {
    if (!cfg.supportsCleanup) {
      console.log(`  • SKIP  3. self-cleanup — ${cfg.noCleanupWarning}`);
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}${cfg.deletePath(BID_ID, artifactId)}`, {
        method: "DELETE",
        headers: authHeaders(markerFor(cfg.cleanupMarkerHeader)),
        redirect: "manual",
      });
      if (res.status !== cfg.deleteExpectedStatus) {
        record(
          "3. self-cleanup delete",
          "FAIL",
          `status=${res.status} (expected ${cfg.deleteExpectedStatus}) — this run's own artifact was NOT removed; a manual DELETE may still be required`
        );
        return;
      }
      record("3. self-cleanup delete", "PASS", `status=${res.status}`);
      // Where the cleanup route itself is gated (addendums), verify the
      // server actually suppressed its provider-bound side effect.
      assertCleanupAutomationSuppressed(res);
    } catch (err) {
      record("3. self-cleanup delete", "FAIL", err.message);
    }
  }

  let exitCode = 0;

  try {
    if (storageOnlyExecute) {
      sessionCookieValue = await promptForCookie();
    }

    console.log("[artifacts-staging-smoke] EXECUTING against a real host — this is not a dry run.");
    console.log(`  DOMAIN=${cfg.label}`);
    console.log(`  RUN_TAG=${RUN_TAG}`);
    console.log(`  BASE_URL=${BASE_URL}`);
    console.log(`  BID_ID=${BID_ID}`);
    console.log(
      `  auth=${
        storageOnlyExecute
          ? "cookie (redacted, entered interactively via --cookie-prompt)"
          : args.cookie
          ? "cookie (redacted)"
          : "bearer (redacted, unconfirmed for these routes)"
      }`
    );
    console.log("");

    let proceed = true;
    if (storageOnlyExecute) {
      if (!looksLikeCookiePair(sessionCookieValue)) {
        record("0a. cookie shape", "FAIL", "the entered value does not look like a complete name=value cookie pair");
        proceed = false;
      } else {
        const preflightOk = await preflightBidStep();
        if (!preflightOk) proceed = false;
      }
    }

    const fileBuf = proceed ? await loadTestFile(args.filePath, RUN_TAG) : null;
    const uploaded = proceed ? await uploadStep(fileBuf) : null;

    if (uploaded) {
      assertAutomationSuppressed("1b. automation suppressed", uploaded);
      await listStep();
      // artifact id is the ONLY id this script ever knows it created —
      // never printed, only used internally to scope the cleanup delete.
      const artifactId = uploaded.id;
      if (artifactId != null) {
        await cleanupDeleteStep(artifactId);
      } else if (cfg.supportsCleanup) {
        record("3. self-cleanup delete", "FAIL", "upload response had no usable id — cannot scope a safe cleanup delete");
      }
    }

    console.log("");
    const pass = results.filter((r) => r.status === "PASS").length;
    const fail = results.filter((r) => r.status === "FAIL").length;
    console.log("===============================================================");
    console.log(`  ${cfg.label.toUpperCase()} ARTIFACTS SMOKE — ${pass} pass · ${fail} fail`);
    console.log("===============================================================");
    console.log("Reminder: this run proves storage/DB mechanics only — it is NOT a");
    console.log("real-AI validation tool.");

    exitCode = fail > 0 ? 1 : 0;
  } finally {
    sessionCookieValue = null;
  }

  process.exit(exitCode);
}

const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  runMain().catch((err) => {
    console.error("[artifacts-staging-smoke] FATAL", err?.message ?? "(unknown error)");
    process.exit(1);
  });
}
