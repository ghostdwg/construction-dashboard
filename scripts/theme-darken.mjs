// One-shot theming script.
//
// Walks app/**/*.tsx and adds dark: variants alongside existing zinc/gray
// utility classes inside className strings. Idempotent: a token that already
// has a corresponding dark: variant in the same className is left alone.
//
// Run: node scripts/theme-darken.mjs
//
// This script ONLY mutates className/class string contents — never imports,
// JSX structure, props, or logic. Verify with `git diff` after running.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..", "app");

// Token translation table.
// Key   = source utility class (light mode, as it currently appears)
// Value = the dark variant to add alongside it
//
// Order matters only when one key is a prefix of another — we sort by length
// descending below to avoid partial-match issues.
const TRANSLATIONS = {
  // Backgrounds — pages, cards, headers, hover states
  "bg-white": "dark:bg-zinc-900",
  "bg-zinc-50": "dark:bg-zinc-800",
  "bg-zinc-100": "dark:bg-zinc-800",
  "bg-zinc-200": "dark:bg-zinc-700",
  "bg-zinc-300": "dark:bg-zinc-600",
  "bg-zinc-900": "dark:bg-zinc-50",
  "bg-zinc-950": "dark:bg-zinc-100",
  "bg-gray-50": "dark:bg-zinc-800",
  "bg-gray-100": "dark:bg-zinc-800",
  "bg-gray-200": "dark:bg-zinc-700",

  // Text — readable contrast in both modes
  "text-zinc-900": "dark:text-zinc-100",
  "text-zinc-800": "dark:text-zinc-100",
  "text-zinc-700": "dark:text-zinc-200",
  "text-zinc-600": "dark:text-zinc-300",
  "text-zinc-500": "dark:text-zinc-400",
  "text-zinc-400": "dark:text-zinc-500",
  "text-gray-900": "dark:text-zinc-100",
  "text-gray-800": "dark:text-zinc-200",
  "text-gray-700": "dark:text-zinc-300",
  "text-gray-600": "dark:text-zinc-400",
  "text-gray-500": "dark:text-zinc-500",

  // Borders
  "border-zinc-100": "dark:border-zinc-800",
  "border-zinc-200": "dark:border-zinc-700",
  "border-zinc-300": "dark:border-zinc-600",
  "border-gray-200": "dark:border-zinc-700",
  "border-gray-300": "dark:border-zinc-600",

  // Dividers (Tailwind divide-x/y child border)
  "divide-zinc-100": "dark:divide-zinc-800",
  "divide-zinc-200": "dark:divide-zinc-700",

  // Hover states
  "hover:bg-zinc-50": "dark:hover:bg-zinc-800",
  "hover:bg-zinc-100": "dark:hover:bg-zinc-800",
  "hover:bg-zinc-200": "dark:hover:bg-zinc-700",
  "hover:text-zinc-700": "dark:hover:text-zinc-200",
  "hover:text-zinc-800": "dark:hover:text-zinc-100",
  "hover:text-zinc-900": "dark:hover:text-zinc-100",

  // Placeholder text
  "placeholder-zinc-400": "dark:placeholder-zinc-500",
  "placeholder-zinc-500": "dark:placeholder-zinc-500",
};

const SOURCE_KEYS = Object.keys(TRANSLATIONS).sort((a, b) => b.length - a.length);

// ── Process one className string ───────────────────────────────────────────

function transformClassNameString(classStr) {
  // Split into tokens (whitespace-separated). Preserve original separators in
  // the rebuilt string by joining with single spaces — JSX collapses extra
  // whitespace anyway.
  const tokens = classStr.trim().split(/\s+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const additions = [];

  for (const token of tokens) {
    // Match longest source key that fully equals this token.
    // Tokens like `text-zinc-500` should match `text-zinc-500` not `text-zinc-50`.
    if (SOURCE_KEYS.includes(token)) {
      const darkVariant = TRANSLATIONS[token];
      // Only add if no corresponding dark: token already in the className.
      if (!tokenSet.has(darkVariant)) {
        additions.push(darkVariant);
        tokenSet.add(darkVariant);
      }
    }
  }

  if (additions.length === 0) return classStr;
  return tokens.concat(additions).join(" ");
}

// ── Walk a file and rewrite className string literals ──────────────────────

// Match:
//   className="...": double-quoted
//   className='...': single-quoted
//   className={`...`}: backtick template literal (only if NO ${} interpolation;
//                       templates with interpolation are skipped to avoid
//                       breaking dynamic class composition)
//
// Note: this regex is line-based (no /s flag). className strings should not
// contain raw newlines — that's a JSX style violation anyway.
const CLASSNAME_RE =
  /(\bclassName\s*=\s*)("([^"]*)"|'([^']*)'|`([^`$]*)`)/g;

function transformFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let changed = 0;

  const updated = original.replace(CLASSNAME_RE, (match, prefix, _full, dq, sq, tpl) => {
    const raw = dq ?? sq ?? tpl;
    if (raw === undefined) return match;
    const transformed = transformClassNameString(raw);
    if (transformed === raw) return match;
    changed++;
    if (dq !== undefined) return `${prefix}"${transformed}"`;
    if (sq !== undefined) return `${prefix}'${transformed}'`;
    return `${prefix}\`${transformed}\``;
  });

  if (changed > 0) {
    fs.writeFileSync(filePath, updated, "utf8");
  }
  return changed;
}

// ── Walk directory ─────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────

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
console.log(`Modified ${totalFiles} files, ${totalChanges} className strings updated`);
