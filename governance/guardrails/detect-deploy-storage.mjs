// governance/guardrails/detect-deploy-storage.mjs
//
// P0 guardrail (WARN MODE by default): warn on prohibited deployment/storage
// egress paths — Fly.io deploys and S3 / cloud object storage.
//
// It does NOT remove or alter any existing file and never contacts a remote.
// Existing legacy artifacts (the runtime/fly/*.toml files, the STORAGE_BACKEND
// selector) are documented as blocked/deprecated via allowlist.json and are
// reported as "existing prohibited (not removed)". Anything that would ACTIVATE
// them (a `fly deploy` invocation, STORAGE_BACKEND=s3, `new S3BlobStore(`, a new
// cloud-storage SDK) is reported as WOULD-BLOCK.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot, walk, scanFiles, loadAllowlist, finish } from "./_common.mjs";

// Activation patterns = WOULD-BLOCK (these change egress posture).
export const ACTIVATION_RULES = [
  { id: "fly-deploy-cmd", re: /\bfly(ctl)?\s+deploy\b/, note: "active Fly.io deploy invocation" },
  { id: "s3-backend-selected", re: /STORAGE_BACKEND\s*[=:]\s*["']?s3\b/i, note: "S3 storage backend selected" },
  { id: "s3blobstore-usage", re: /\bnew\s+S3BlobStore\s*\(/, note: "S3BlobStore instantiated" },
  {
    id: "cloud-storage-sdk",
    re: /@aws-sdk\/client-s3|\bnew\s+S3Client\s*\(|require\(\s*["']aws-sdk["']\)|@google-cloud\/storage|@azure\/storage-blob/,
    note: "new cloud-storage SDK usage",
  },
];

function main() {
  const root = repoRoot();
  const allow = loadAllowlist(root);
  const legacy = allow.deploy_storage || [];

  // 1) Scan source for ACTIVATION patterns (would-block).
  const files = walk(root, ["app", "lib", "sidecar", "gpu-worker", "scripts", "runtime", ".github"], [
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh", ".yml", ".yaml",
  ]);
  const findings = scanFiles(root, files, ACTIVATION_RULES);

  // Known pre-existing (documented) activation sites are reported but not
  // treated as NEW would-block. Anything else matching activation is would-block.
  const knownActive = new Map((allow.deploy_storage_known || []).map((e) => [e.path, e]));

  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.relPath)) byFile.set(f.relPath, []);
    byFile.get(f.relPath).push(f);
  }
  const known = [];
  const wouldBlock = [];
  for (const [file, hits] of [...byFile.entries()].sort()) {
    const rec = {
      file,
      rules: [...new Set(hits.map((h) => h.ruleId))].join(","),
      lines: hits.map((h) => h.lineNo),
    };
    if (knownActive.has(file)) {
      const k = knownActive.get(file);
      known.push({ ...rec, reason: k.reason, status: k.status });
    } else {
      wouldBlock.push(rec);
    }
  }

  // Existing latent artifacts (present but not removed this phase).
  const legacyPresent = legacy.map((e) => ({ ...e, present: fs.existsSync(path.join(root, e.path)) }));

  console.log("== Deploy/storage egress guardrail ==");
  console.log(
    `\nEXISTING prohibited-but-not-removed (documented, unchanged this phase): ${legacyPresent.length + known.length}`
  );
  for (const l of legacyPresent)
    console.log(`  [${l.present ? "PRESENT" : "ABSENT"}] ${l.path}  (${l.status}) — ${l.reason}`);
  for (const k of known)
    console.log(`  [KNOWN-ACTIVE] ${k.file}:${k.lines.join(",")}  {${k.rules}} (${k.status}) — ${k.reason}`);

  console.log(`\nWOULD-BLOCK (NEW cloud deploy/storage activation, not previously known): ${wouldBlock.length}`);
  for (const w of wouldBlock) console.log(`  [WARN] ${w.file}:${w.lines.join(",")}  {${w.rules}}`);

  finish("deploy-storage", wouldBlock.length);
}

// Run only when invoked directly (not when imported, e.g. by selftest.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
