// Removes duplicate dark: variants from className strings.
//
// After running theme-darken.mjs, any file that previously had partial dark
// coverage may end up with two competing dark: variants for the same property
// (e.g. `dark:bg-zinc-950 dark:bg-zinc-900`). This script keeps only the FIRST
// dark: variant per property family per className, since the first one was
// the user's intentional value (the second is from the auto-darken pass).
//
// Run AFTER theme-darken.mjs:
//   node scripts/theme-dedup.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..", "app");

// Extract the "property family" from a dark: token so we can detect collisions.
// e.g. dark:bg-zinc-900 → "bg", dark:hover:bg-zinc-800 → "hover:bg",
//      dark:text-zinc-100 → "text", dark:border-zinc-700 → "border"
function darkPropertyFamily(token) {
  if (!token.startsWith("dark:")) return null;
  const rest = token.slice(5);
  // Strip color value: bg-zinc-900 → bg, hover:bg-zinc-800 → hover:bg
  const m = rest.match(/^((?:hover:|focus:|active:)?(?:bg|text|border|divide|placeholder|ring|fill|stroke|outline))-/);
  return m ? m[1] : null;
}

const CLASSNAME_RE =
  /(\bclassName\s*=\s*)("([^"]*)"|'([^']*)'|`([^`$]*)`)/g;

function dedupClassName(classStr) {
  const tokens = classStr.trim().split(/\s+/).filter(Boolean);
  const seenFamilies = new Set();
  const out = [];

  for (const token of tokens) {
    const family = darkPropertyFamily(token);
    if (family) {
      if (seenFamilies.has(family)) continue;
      seenFamilies.add(family);
    }
    out.push(token);
  }

  return out.join(" ");
}

function transformFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let changed = 0;

  const updated = original.replace(CLASSNAME_RE, (match, prefix, _full, dq, sq, tpl) => {
    const raw = dq ?? sq ?? tpl;
    if (raw === undefined) return match;
    const transformed = dedupClassName(raw);
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

console.log(`\nDeduplicated ${totalFiles} files, ${totalChanges} className strings cleaned`);
