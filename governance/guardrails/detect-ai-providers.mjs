// governance/guardrails/detect-ai-providers.mjs
//
// P0 guardrail (WARN MODE by default): detect direct construction/use of
// external AI-provider clients outside the (future) AI gateway.
//
// It does NOT change runtime behavior and never calls any provider. It only
// reads source files and prints findings. Existing known call sites are
// allow-listed by exact path + justification in allowlist.json; anything not
// on the list is reported as WOULD-BLOCK (i.e. would fail once GUARDRAILS_MODE
// is flipped to "enforce").
//
// Run:  GUARDRAILS_MODE=warn node governance/guardrails/detect-ai-providers.mjs
// CI:   GUARDRAILS_MODE=enforce node governance/guardrails/detect-ai-providers.mjs

import { pathToFileURL } from "node:url";
import { repoRoot, walk, scanFiles, loadAllowlist, finish } from "./_common.mjs";

// --- Detection rules (data-driven so P1 can extend them) -------------------
// TypeScript / JavaScript
export const TS_RULES = [
  { id: "anthropic-client", re: /\bnew\s+Anthropic\s*\(/, note: "direct Anthropic client construction" },
  { id: "anthropic-import", re: /(from\s+|require\(\s*)['"]@anthropic-ai\/sdk['"]/, note: "Anthropic SDK import" },
  { id: "openai-client", re: /\bnew\s+OpenAI\s*\(/, note: "direct OpenAI client construction" },
  { id: "openai-import", re: /(from\s+|require\(\s*)['"]openai['"]/, note: "OpenAI SDK import" },
  { id: "assemblyai", re: /\bnew\s+AssemblyAI\s*\(|api\.assemblyai\.com/, note: "AssemblyAI cloud client/endpoint" },
  { id: "direct-model-call", re: /\.messages\.create\s*\(/, note: "direct provider model call" },
];
// Python
export const PY_RULES = [
  { id: "anthropic-client", re: /\banthropic\.Anthropic\s*\(/, note: "direct Anthropic client construction" },
  { id: "anthropic-import", re: /^\s*(from\s+anthropic\s+import\b|import\s+anthropic\b)/, note: "anthropic import" },
  { id: "openai-client", re: /\bOpenAI\s*\(/, note: "direct OpenAI client construction" },
  { id: "openai-import", re: /^\s*(from\s+openai\b|import\s+openai\b)/, note: "openai import" },
  { id: "assemblyai", re: /api\.assemblyai\.com|ASSEMBLYAI_BASE/, note: "AssemblyAI cloud endpoint" },
  { id: "direct-model-call", re: /\.messages\.create\s*\(/, note: "direct provider model call" },
];

function main() {
  const root = repoRoot();
  const allow = loadAllowlist(root);
  const allowSet = new Set((allow.ai_providers || []).map((e) => e.path));
  const allowReason = new Map((allow.ai_providers || []).map((e) => [e.path, e.reason]));

  const tsFiles = walk(root, ["app", "lib"], [".ts", ".tsx", ".js", ".mjs"]);
  const pyFiles = walk(root, ["sidecar", "gpu-worker"], [".py"]);

  const findings = [
    ...scanFiles(root, tsFiles, TS_RULES),
    ...scanFiles(root, pyFiles, PY_RULES),
  ];

  // Group by file; a file is "permitted" (legacy) if allow-listed, else would-block.
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.relPath)) byFile.set(f.relPath, []);
    byFile.get(f.relPath).push(f);
  }

  const permitted = [];
  const wouldBlock = [];
  for (const [file, hits] of [...byFile.entries()].sort()) {
    const rules = [...new Set(hits.map((h) => h.ruleId))].join(",");
    const record = { file, rules, lines: hits.map((h) => h.lineNo) };
    if (allowSet.has(file)) permitted.push({ ...record, reason: allowReason.get(file) });
    else wouldBlock.push(record);
  }

  console.log("== AI-provider direct-use guardrail ==");
  console.log(`scanned: ${tsFiles.length} TS/JS + ${pyFiles.length} PY files`);
  console.log(`\nPERMITTED legacy call sites (allow-listed, pending P1 gateway): ${permitted.length}`);
  for (const p of permitted) console.log(`  [OK] ${p.file}  {${p.rules}}  — ${p.reason}`);

  console.log(`\nWOULD-BLOCK (new direct provider use, not allow-listed): ${wouldBlock.length}`);
  for (const w of wouldBlock) console.log(`  [WARN] ${w.file}:${w.lines.join(",")}  {${w.rules}}`);

  // Allow-list hygiene: entries pointing at files that no longer match.
  const matchedFiles = new Set(byFile.keys());
  const stale = (allow.ai_providers || []).filter((e) => !matchedFiles.has(e.path));
  if (stale.length) {
    console.log(`\nSTALE allow-list entries (no longer detected — remove when migrated): ${stale.length}`);
    for (const s of stale) console.log(`  [INFO] ${s.path}`);
  }

  finish("ai-providers", wouldBlock.length);
}

// Run only when invoked directly (not when imported, e.g. by selftest.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
