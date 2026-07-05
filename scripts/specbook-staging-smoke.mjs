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
//     supplied together: --base-url, --bid-id, an auth input, --execute, AND
//     --storage-only. Missing any one of these keeps the script in dry-run
//     mode. In --execute --storage-only mode specifically, the ONLY accepted
//     auth input is the new --cookie-prompt flag (see "SECURE COOKIE PROMPT"
//     below) — passing --cookie or --bearer directly alongside
//     --execute --storage-only is a hard refusal, not just discouraged.
//   - No dependency beyond what Node 18+ / this repo already provides:
//     global fetch/FormData/Blob (same primitives
//     app/api/bids/[id]/specbook/upload/route.ts already uses) and node:*
//     builtins (same as scripts/validate-staging.mjs), including the
//     --cookie-prompt hidden-input mechanism below, which is built directly
//     on process.stdin raw-mode handling — no readline "password" package,
//     no third-party prompt library. No package.json change was made to add
//     this script.
//   - This script never retries a failing step in a loop. Each step runs
//     once; on failure it records FAIL and moves on so the operator gets a
//     full picture in one pass (see the runbook's §5 "do not loop retries").
//   - This script never touches /specbook/analyze or /specbook/analyze/complete
//     — those depend on a working Anthropic credential (staging's known 401)
//     and are explicitly out of scope for this helper.
//   - This script was written but never executed against any real host as
//     part of producing it or the runbook it accompanies.
//
// STORAGE-ONLY MODE (work package: specbook-storage-smoke-isolation):
//
//   Until the Anthropic credential rotation lands, this script can ONLY ever
//   perform a storage-only run — there is no "real-AI" execute mode anymore.
//   `--execute` alone is refused; a NEW required flag, `--storage-only`, must
//   also be passed. This maps to the four-condition suppression contract in
//   app/api/bids/[id]/specbook/upload/route.ts: authenticated admin session
//   (via --cookie-prompt, entered interactively for an admin account — see
//   "SECURE COOKIE PROMPT" below; --cookie/--bearer are rejected in this
//   mode) + this script's marker
//   header + the server's own STORAGE_SMOKE_MODE_ENABLED=true + the server's
//   own APP_ENV=staging. This script supplies only the header — the other
//   three conditions are the server operator's responsibility and are out of
//   this script's control by design (a client can never prove them).
//
//   The marker header (sent ONLY in storage-only execute mode, never in dry
//   run, never without --storage-only) is:
//     X-Specbook-Storage-Smoke: 1
//
// SECURE COOKIE PROMPT (work package: specbook-smoke-cookie-prompt):
//
//   A real staging session cookie must never appear as a CLI argument — argv
//   is visible in shell history, in `ps`/process listings on shared hosts,
//   and (in this coordination context) would be echoed verbatim into any
//   chat transcript of an assistant invoking this command. So in
//   --execute --storage-only mode, --cookie-prompt is REQUIRED:
//
//     - It refuses immediately (before any HTTP request, before even
//       attempting to read from stdin) if process.stdin/process.stdout are
//       not both an interactive TTY — this keeps CI/non-interactive
//       invocations failing safely instead of hanging or silently reading
//       garbage from a pipe.
//     - If TTY, it prompts the operator to type/paste the cookie value with
//       terminal echo suppressed, via raw-mode stdin handling (see
//       promptForCookie() below) — no new dependency, no readline "password"
//       trick, just process.stdin.setRawMode(true) plus manual keypress
//       handling that never writes typed characters back to the terminal.
//     - The entered value is held ONLY in a local `let` in runMain()'s own
//       scope — never assigned onto the `args` object parseArgs() returns
//       (which is otherwise a plain data bag other code could reasonably log
//       or JSON.stringify for debugging) — and is cleared (reassigned to
//       null) in a `finally` block once the entire 6-step request flow
//       finishes, success or failure.
//     - Passing --cookie or --bearer directly alongside
//       --execute --storage-only is REJECTED with a message pointing at
//       --cookie-prompt, before any network action — those flags remain
//       available for other purposes (see the auth note below), just not in
//       storage-only execute mode.
//
//   After the first upload (and the step-6 re-upload), this script asserts
//   the response's `automationStatus` field is exactly
//   "suppressed_for_storage_smoke" and FAILS LOUDLY if it is missing or any
//   other value — that would mean the server-side suppression did not
//   actually engage (e.g. an operator forgot STORAGE_SMOKE_MODE_ENABLED or
//   ran this against a non-staging tier), and a real Anthropic call may have
//   just fired despite the pending credential rotation.
//
// Usage (dry run — always safe, this is the only mode used while authoring
// this script):
//
//   node scripts/specbook-staging-smoke.mjs
//   node scripts/specbook-staging-smoke.mjs --base-url https://staging.example --bid-id 123
//     (still dry-run: --execute, --storage-only, and an auth input are all missing)
//
// Usage (real run — operator-driven, storage-only, requires an interactive
// terminal, the --cookie-prompt flag, AND an admin session AND the
// server-side flags described above). Run this LOCALLY, in your own
// terminal — never via a remote/shared execution context, since the whole
// point of --cookie-prompt is that the cookie value never leaves your own
// machine's memory:
//
//   node scripts/specbook-staging-smoke.mjs \
//     --base-url https://staging.groundworx.neuroglitch.ai \
//     --bid-id 123 \
//     --cookie-prompt \
//     --execute \
//     --storage-only
//
//   (the script will then prompt: "Enter the staging session cookie value
//   (input hidden, press Enter when done): " — paste an ADMIN account's
//   session cookie header value; nothing will echo to the terminal)
//
//   Optional: --pdf /path/to/local/test.pdf   (defaults to a tiny synthetic
//   PDF generated in-memory with two fake CSI-style section headers — never
//   a real project document; see the runbook §5 no-secret-fixture rule).
//
// Auth note: this app's session is a NextAuth JWT cookie (lib/auth.ts), not
// a bearer token scheme for these routes. --bearer is accepted for forward
// compatibility / operator convenience on non-storage-only invocations, but
// is NOT confirmed to authenticate against these routes today — --cookie
// (or, in storage-only mode, --cookie-prompt) is the realistic option.
// Flagged here as a judgment call for the operator, not asserted as
// supported. In --execute --storage-only mode specifically, --cookie and
// --bearer are BOTH rejected in favor of --cookie-prompt — see "SECURE
// COOKIE PROMPT" above for why, and note that today --storage-only is
// required for every --execute run this script supports at all, so
// --bearer currently has no live real-run path here; it is left in place,
// unrejected, only for whatever future non-storage-only real-run mode this
// script might grow.
//
// --base-url tightening: in any real (--execute) run, --base-url must
// contain the substring "staging" (case-insensitive) — matching this repo's
// actual staging hostname convention (runtime/env/staging.env.example:
// NEXTAUTH_URL=https://staging.groundworx.neuroglitch.ai). This is a
// client-side, easily-bypassed sanity check, not a security boundary — the
// real boundary is the server's own APP_ENV=staging fence. It exists only to
// catch an operator fat-fingering a production URL into this script.
//
// TESTABILITY: parseArgs(), runMain(), and promptForCookie() are exported so
// scripts/__tests__/specbook-staging-smoke.test.ts can drive both the
// dry-run and refusal paths in-process (spying on global fetch and
// process.exit), and drive the hidden-input mechanism itself with fake
// stream stand-ins, without ever spawning a real child process or touching a
// real host. This mirrors the auto-run guard already used by
// scripts/cron-loop.mjs ("Auto-run when invoked as a script (not when
// imported by tests)").

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Non-secret intent marker — must match app/api/bids/[id]/specbook/upload/
// route.ts's STORAGE_SMOKE_HEADER exactly. Sent ONLY in storage-only execute
// mode.
const STORAGE_SMOKE_HEADER = "X-Specbook-Storage-Smoke";
const REQUIRED_AUTOMATION_STATUS = "suppressed_for_storage_smoke";

// ── Argv parsing (no dependency, pure) ──────────────────────────────────────

export function parseArgs(argv) {
  const args = { execute: false, storageOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") { args.execute = true; continue; }
    if (a === "--storage-only") { args.storageOnly = true; continue; }
    if (a === "--base-url") { args.baseUrl = argv[++i]; continue; }
    if (a === "--bid-id") { args.bidId = argv[++i]; continue; }
    if (a === "--cookie") { args.cookie = argv[++i]; continue; }
    if (a === "--bearer") { args.bearer = argv[++i]; continue; }
    if (a === "--cookie-prompt") { args.cookiePrompt = true; continue; }
    if (a === "--pdf") { args.pdfPath = argv[++i]; continue; }
    if (a === "--help" || a === "-h") { args.help = true; continue; }
  }
  return args;
}

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
                         (must contain "staging" — see --base-url tightening
                          note in this script's header comment)
  --bid-id <n>           an existing staging Bid.id to run the flow against
  --cookie-prompt        REQUIRED (in place of --cookie/--bearer) for
                         --execute --storage-only runs — interactively
                          prompts for the session cookie with echo disabled,
                          so the value never appears in argv/shell history.
                          Requires an interactive TTY; refused otherwise.
                          Passing --cookie or --bearer directly alongside
                          --execute --storage-only is REJECTED — this script
                          will tell you to use --cookie-prompt instead.
  --execute              explicit confirmation to perform real HTTP requests
  --storage-only         explicit confirmation this is a storage-only run —
                         REQUIRED alongside --execute. This script no longer
                          has any other real-run mode: --execute without
                          --storage-only is refused, not just left dry-run.

Optional: --pdf <path>   a local test PDF (defaults to a tiny synthetic one
                          generated in-memory — never a real project document).

Missing any of the required inputs above keeps this script in dry-run
mode, as it is right now. This is NOT a real-AI validation tool — it proves
storage/DB mechanics only. See runtime/runbooks/specbook-staging-validation.md
for the storage-only vs real-AI distinction.
`;

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

async function loadTestPdf(pdfPath) {
  if (pdfPath) {
    const { readFile } = await import("node:fs/promises");
    return await readFile(pdfPath);
  }
  return buildSyntheticPdf([
    "SECTION 09 91 00 - PAINTING",
    "This section covers field-applied paint systems.",
    "SECTION 26 05 00 - ELECTRICAL",
    "This section covers basic electrical materials and methods.",
  ]);
}

// ── Secure interactive cookie prompt (storage-only execute mode) ───────────
//
// Node has no single built-in "hidden input" primitive. This implements one
// directly on process.stdin's raw mode rather than adding a dependency:
// raw mode disables the terminal driver's own canonical-mode line editing
// AND character echo, so as long as we never write the typed characters
// back to stdout ourselves (we don't — only a literal trailing "\n" is
// written once the operator presses Enter), nothing appears on screen while
// the value is typed or pasted.
//
// `streams` is accepted (defaulting to the real process.stdin/stdout) so
// scripts/__tests__/specbook-staging-smoke.test.ts can drive this function
// directly with fake, in-memory stream stand-ins — feeding it a sentinel
// value programmatically — without needing a real TTY or touching the
// actual process.stdin, mirroring this file's existing parseArgs()/runMain()
// exported-for-testability convention (see the TESTABILITY note above).
//
// The returned Promise resolves with the entered value as a plain string.
// Callers MUST hold that value only in their own local variable (never on
// the `args` object, which other code may reasonably log/stringify) and
// clear it once it is no longer needed — see runMain()'s try/finally below.
export function promptForCookie(streams = {}) {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? process.stdout;

  return new Promise((resolvePromise, reject) => {
    if (!stdin.isTTY || !stdout.isTTY) {
      // Defense in depth — runMain()'s missing-input gate already refuses
      // before ever reaching here, but this function must never attempt
      // raw-mode stdin manipulation against a non-TTY stream regardless of
      // how it is invoked.
      reject(new Error("--cookie-prompt requires an interactive TTY; refusing to read from stdin."));
      return;
    }

    stdout.write(
      "[specbook-staging-smoke] Enter the staging session cookie value (input hidden, press Enter when done): "
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
          // Ctrl-C — abort without ever logging the partial value.
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
//
// Exported (rather than only run as a bare top-level script) so tests can
// invoke it directly with a synthetic argv, spying on global fetch and
// process.exit, without spawning a real process or touching a real host.

export async function runMain(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  // The only real-run mode this script supports at all today (see the
  // STORAGE-ONLY MODE header note) — kept as a named boolean since it gates
  // both the auth-input rules below and, further down, which auth mechanism
  // authHeaders() is allowed to read from.
  const storageOnlyExecute = args.execute && args.storageOnly;

  const missing = [];
  if (!args.baseUrl) {
    missing.push("--base-url");
  } else if (args.execute && !/staging/i.test(args.baseUrl)) {
    missing.push('--base-url must reference a staging host (contain "staging") for any real run');
  }
  if (!args.bidId) missing.push("--bid-id");

  if (storageOnlyExecute) {
    // Storage-only execute mode: --cookie-prompt is the ONLY supported auth
    // mechanism. --cookie/--bearer passed directly here would put a real
    // session value in argv/shell history (and, in an assistant-driven
    // invocation, a chat transcript) — reject before any network action,
    // before the interactive prompt is even attempted.
    if (args.cookie) {
      missing.push(
        "Passing --cookie directly is not permitted in storage-only execute mode — use --cookie-prompt instead so the session value never appears in argv/shell history. Refusing."
      );
    }
    if (args.bearer) {
      missing.push(
        "Passing --bearer directly is not permitted in storage-only execute mode — use --cookie-prompt instead so the session value never appears in argv/shell history. Refusing."
      );
    }
    if (!args.cookiePrompt) {
      missing.push(
        "--cookie-prompt (required in --execute --storage-only mode — this is now the only supported auth input for storage-only runs)"
      );
    } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
      // Checked even before the prompt would be attempted, so a
      // non-interactive/CI invocation fails safely and immediately rather
      // than hanging or silently reading garbage from a pipe.
      missing.push(
        "--cookie-prompt requires an interactive terminal (process.stdin/process.stdout must both be a TTY) — refusing to prompt in a non-interactive environment; run this script locally in your own terminal"
      );
    }
  } else {
    if (!args.cookie && !args.bearer) missing.push("--cookie or --bearer");
  }

  if (!args.execute) missing.push("--execute");
  if (args.execute && !args.storageOnly) {
    missing.push("--storage-only (required — --execute alone is refused, this helper has no real-AI run mode)");
  }

  if (args.help || missing.length > 0) {
    console.log(PLAN);
    if (missing.length > 0 && !args.help) {
      console.log(`[specbook-staging-smoke] Not executing — missing/invalid: ${missing.join(", ")}`);
    }
    process.exit(0);
    return; // unreachable when process.exit is real; defensive when mocked in tests
  }

  // ── From here down: real-run path. Only reached when base-url, bid-id, an
  // auth input, --execute, AND --storage-only were ALL supplied explicitly. ──

  const BASE_URL = args.baseUrl.replace(/\/+$/, "");
  const BID_ID = args.bidId;
  const RUN_TAG = `smoke-${Date.now()}-${randomUUID().slice(0, 6)}`;

  // Holds the interactively-entered cookie value (storage-only mode only).
  // Deliberately a bare local `let` in runMain()'s own scope — never
  // assigned onto `args` (a plain data bag other code may reasonably log or
  // JSON.stringify) — and cleared in the `finally` block below once the
  // entire 6-step request flow finishes, success or failure. A simple
  // dereference (reassign to null) is the strongest erasure Node/V8 exposes
  // without a native addon: JS strings are immutable and there is no public
  // "overwrite these bytes in place" primitive, so this drops the only
  // reference and makes the string eligible for GC immediately rather than
  // living for the rest of this short-lived, single-purpose process.
  let sessionCookieValue = null;

  function authHeaders() {
    const h = {};
    if (storageOnlyExecute) {
      // Storage-only mode: the ONLY accepted auth input is the
      // interactively-prompted cookie value — args.cookie/args.bearer are
      // already rejected above and can never reach here.
      if (sessionCookieValue) h["Cookie"] = sessionCookieValue;
    } else {
      if (args.cookie) h["Cookie"] = args.cookie;
      if (args.bearer) h["Authorization"] = `Bearer ${args.bearer}`;
    }
    // Sent ONLY in storage-only execute mode. We are already past the
    // missing-inputs gate above (which requires --storage-only for any
    // --execute run), so args.storageOnly is always true here in practice —
    // the explicit check is defense-in-depth against future refactors.
    if (args.execute && args.storageOnly) h[STORAGE_SMOKE_HEADER] = "1";
    return h;
  }

  const results = [];
  function record(name, ok, detail) {
    const symbol = ok === "PASS" ? "✔" : ok === "FAIL" ? "✗" : "•";
    results.push({ name, status: ok, detail });
    console.log(`  ${symbol} ${ok.padEnd(5)} ${name}${detail ? " — " + detail : ""}`);
  }

  // Fail loudly if the server did not actually engage suppression — this is
  // the one honest signal we have that a real Anthropic call was (or wasn't)
  // avoided. Never skip this check silently.
  function assertAutomationSuppressed(label, body) {
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

  // exitCode is computed inside the try below and only acted on (via
  // process.exit) once the try/finally has fully unwound — process.exit()
  // terminates the process immediately and does NOT run pending `finally`
  // blocks further up the call stack, so the cookie-clearing finally below
  // would silently never run if process.exit were called from inside it.
  let exitCode = 0;

  try {
    // Prompt for the session cookie now, inside the try, so that ANY
    // failure during entry (including a Ctrl-C abort) still routes through
    // the finally below and clears sessionCookieValue.
    if (storageOnlyExecute) {
      sessionCookieValue = await promptForCookie();
    }

    console.log("[specbook-staging-smoke] EXECUTING against a real host — this is not a dry run.");
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

    const pdf = await loadTestPdf(args.pdfPath);

    const first = await uploadStep("1. upload", pdf);
    if (first) {
      assertAutomationSuppressed("1c. automation suppressed", first);
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
      if (second) {
        assertAutomationSuppressed("6c. automation suppressed", second);
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

    exitCode = fail > 0 ? 1 : 0;
  } finally {
    // Clear the interactively-entered cookie now that the entire 6-step
    // request flow has completed (success or failure) — see the
    // sessionCookieValue declaration above for why a dereference is judged
    // sufficient here.
    sessionCookieValue = null;
  }

  process.exit(exitCode);
}

// Auto-run when invoked as a script (not when imported by tests) — same
// guard convention as scripts/cron-loop.mjs ("Auto-run when invoked as a
// script (not when imported by tests)").
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  runMain().catch((err) => {
    console.error("[specbook-staging-smoke] FATAL", err);
    process.exit(1);
  });
}
