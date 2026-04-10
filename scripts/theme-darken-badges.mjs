// Adds dark: variants to badge-style string literals.
//
// Many components define color maps like:
//   const STATUS_BADGE = { active: "bg-blue-100 text-blue-700", ... }
// or use raw string literals as fallback values:
//   className={`... ${MAP[k] ?? "bg-zinc-100 text-zinc-500"}`}
//
// These are NOT inside a className= attribute, so theme-darken.mjs skips them.
// This script targets "bg-COLOR-LIGHTSHADE text-COLOR-DARKSHADE" pairs anywhere
// in .tsx files (must appear in a string literal so we don't munge regular code)
// and adds dark: variants for both halves.
//
// Color → dark equivalents:
//   bg-zinc-100   → dark:bg-zinc-800
//   bg-zinc-50    → dark:bg-zinc-900/40
//   bg-COLOR-100  → dark:bg-COLOR-900/40   (for red, amber, green, blue, etc.)
//   bg-COLOR-50   → dark:bg-COLOR-900/30
//   text-zinc-N   → dark:text-zinc-300
//   text-COLOR-N  → dark:text-COLOR-300/400 depending on shade
//
// Idempotent: skips strings that already contain a `dark:` token.
//
// Run AFTER theme-darken.mjs:
//   node scripts/theme-darken-badges.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..", "app");

// Match a string literal containing a `bg-X-N text-X-N` pair (in any order),
// optionally surrounded by other classes. We work with both double and single
// quotes. The literal is captured so we can rewrite its body.
const BADGE_LITERAL_RE = /(["'])((?:[^"'\\]|\\.)*?\bbg-[a-z]+-\d+(?:\/\d+)?\s+(?:[^"'\\]|\\.)*?\btext-[a-z]+-\d+(?:[^"'\\]|\\.)*?)\1/g;
// Reverse: text-X-N before bg-X-N
const BADGE_LITERAL_RE_REVERSE = /(["'])((?:[^"'\\]|\\.)*?\btext-[a-z]+-\d+(?:[^"'\\]|\\.)*?\bbg-[a-z]+-\d+(?:\/\d+)?(?:[^"'\\]|\\.)*?)\1/g;

function darkBgFor(token) {
  // bg-zinc-50  → dark:bg-zinc-900/40
  // bg-zinc-100 → dark:bg-zinc-800
  // bg-zinc-200 → dark:bg-zinc-700
  // bg-COLOR-50/100 → dark:bg-COLOR-900/40
  const m = token.match(/^bg-([a-z]+)-(\d+)$/);
  if (!m) return null;
  const [, color, shade] = m;
  const shadeNum = parseInt(shade, 10);
  if (color === "zinc" || color === "gray" || color === "slate" || color === "stone" || color === "neutral") {
    if (shadeNum <= 50) return `dark:bg-${color}-900/40`;
    if (shadeNum <= 100) return `dark:bg-${color}-800`;
    if (shadeNum <= 200) return `dark:bg-${color}-700`;
    if (shadeNum <= 300) return `dark:bg-${color}-600`;
    return null;
  }
  // Colorful pastel backgrounds (red, amber, green, blue, purple, etc.)
  if (shadeNum <= 50) return `dark:bg-${color}-900/30`;
  if (shadeNum <= 100) return `dark:bg-${color}-900/40`;
  if (shadeNum <= 200) return `dark:bg-${color}-900/60`;
  return null;
}

function darkTextFor(token) {
  const m = token.match(/^text-([a-z]+)-(\d+)$/);
  if (!m) return null;
  const [, color, shade] = m;
  const shadeNum = parseInt(shade, 10);
  if (color === "zinc" || color === "gray" || color === "slate" || color === "stone" || color === "neutral") {
    // Even when light text is zinc-400 (faint), in dark mode bump to a readable shade
    if (shadeNum >= 700) return `dark:text-${color}-200`;
    if (shadeNum >= 600) return `dark:text-${color}-300`;
    if (shadeNum >= 500) return `dark:text-${color}-400`;
    return `dark:text-${color}-400`;
  }
  // Colorful text — keep similar perceptual brightness in dark mode
  if (shadeNum >= 700) return `dark:text-${color}-300`;
  if (shadeNum >= 600) return `dark:text-${color}-400`;
  return `dark:text-${color}-400`;
}

function transformLiteralBody(body) {
  // Skip if already has a dark variant
  if (body.includes("dark:")) return body;

  const tokens = body.split(/\s+/).filter(Boolean);
  const additions = [];
  let touched = false;

  for (const t of tokens) {
    const dbg = darkBgFor(t);
    if (dbg && !additions.includes(dbg)) {
      additions.push(dbg);
      touched = true;
      continue;
    }
    const dtxt = darkTextFor(t);
    if (dtxt && !additions.includes(dtxt)) {
      additions.push(dtxt);
      touched = true;
    }
  }

  if (!touched) return body;
  return tokens.concat(additions).join(" ");
}

function transformFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let changed = 0;

  const replacer = (match, quote, body) => {
    const updated = transformLiteralBody(body);
    if (updated === body) return match;
    changed++;
    return `${quote}${updated}${quote}`;
  };

  let updated = original.replace(BADGE_LITERAL_RE, replacer);
  updated = updated.replace(BADGE_LITERAL_RE_REVERSE, replacer);

  if (changed > 0) {
    fs.writeFileSync(filePath, updated, "utf8");
  }
  return changed;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(APP_DIR);
let totalFiles = 0;
let totalChanges = 0;

for (const file of files) {
  const changes = transformFile(file);
  if (changes > 0) {
    totalFiles++;
    totalChanges += changes;
    const rel = path.relative(path.resolve(__dirname, ".."), file);
    console.log(`  ${changes.toString().padStart(3)}  ${rel}`);
  }
}

console.log(`\nProcessed ${files.length} .tsx files`);
console.log(`Modified ${totalFiles} files, ${totalChanges} badge literals updated`);
