// governance/guardrails/_common.mjs
//
// Shared, dependency-free helpers for the P0 confidential-data guardrails.
// Pure filesystem + regex. Never contacts the network or any external service.
// No provider SDKs are imported here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Repo root = two levels up from governance/guardrails/.
export function repoRoot() {
  return path.resolve(HERE, "..", "..");
}

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "__tests__",
  "governance", // never scan the guardrails themselves
]);

// Recursively collect files under `dirs` (relative to root) matching `exts`.
export function walk(root, dirs, exts, ignore = DEFAULT_IGNORE) {
  const out = [];
  const extSet = new Set(exts);
  const visit = (abs) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") {
        // skip dotfiles/dirs except explicitly-scanned ones
      }
      if (ignore.has(e.name)) continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) {
        visit(child);
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (extSet.has(ext) && !e.name.endsWith(".example")) out.push(child);
      }
    }
  };
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs)) visit(abs);
  }
  return out;
}

// Scan files line-by-line against `rules` = [{ id, re, note }].
// Returns findings: { relPath, lineNo, ruleId, note }.
export function scanFiles(root, files, rules) {
  const findings = [];
  for (const abs of files) {
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, abs);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const rule of rules) {
        if (rule.re.test(lines[i])) {
          findings.push({ relPath: rel, lineNo: i + 1, ruleId: rule.id, note: rule.note });
        }
      }
    }
  }
  return findings;
}

export function loadAllowlist(root) {
  const p = path.join(root, "governance", "guardrails", "allowlist.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function mode() {
  const m = (process.env.GUARDRAILS_MODE || "warn").toLowerCase();
  return m === "enforce" ? "enforce" : "warn";
}

// Decide process exit: warn mode always 0; enforce mode 1 if any would-block.
export function finish(label, wouldBlockCount) {
  const m = mode();
  console.log(
    `\n[${label}] mode=${m} would_block=${wouldBlockCount} ` +
      (m === "enforce" && wouldBlockCount > 0 ? "=> FAIL" : "=> OK (no runtime impact)")
  );
  if (m === "enforce" && wouldBlockCount > 0) process.exitCode = 1;
}
