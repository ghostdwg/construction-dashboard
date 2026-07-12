#!/usr/bin/env npx tsx
// scripts/verify-scrape-schedule.ts
//
// Health-check script: for each configured market source, shows last scraped
// time, cadence, and whether the source is due/overdue.
//
// Safe to run anytime — read-only DB access, no provider calls, no side effects.
//
// Usage: npx tsx scripts/verify-scrape-schedule.ts

import * as fs from "fs";
import * as path from "path";

// Load env files (Next.js precedence)
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), f);
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function fmtAge(d: Date | null): string {
  if (!d) return "never";
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

(async () => {
  const now = new Date();

  const sources = await prisma.marketSource.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      jurisdiction: true,
      isActive: true,
      lastScannedAt: true,
      publishStatus: true,
      publishCadenceDays: true,
      cadenceConfidence: true,
    },
  });

  if (sources.length === 0) {
    console.log("No market sources configured.");
    await prisma.$disconnect();
    return;
  }

  const SAFETY_FLOOR_DAYS = 7;

  const header = [
    pad("Source", 30),
    pad("Status", 18),
    pad("Last Scan", 14),
    pad("Cadence", 12),
    "Health",
  ].join("  ");

  console.log("\nMarket Intelligence Scrape Schedule\n");
  console.log(header);
  console.log("-".repeat(header.length));

  let overdueCount = 0;

  for (const src of sources) {
    const lastScannedAt = src.lastScannedAt;
    const cadenceDays = src.publishCadenceDays;

    let health: string;
    if (!src.isActive) {
      health = "PAUSED";
    } else if (src.publishStatus === "OPERATOR_REVIEW") {
      health = "HOLD (operator review)";
    } else if (src.publishStatus === "STALE_PUBLISH") {
      health = "HOLD (stale publish)";
    } else if (!lastScannedAt) {
      health = "⚠ OVERDUE (never scanned)";
      overdueCount++;
    } else {
      const daysSince = (now.getTime() - lastScannedAt.getTime()) / 86_400_000;
      const floorDays = cadenceDays ?? SAFETY_FLOOR_DAYS;
      if (daysSince > floorDays) {
        health = `⚠ OVERDUE (${Math.floor(daysSince)}d since last scan, floor ${Math.floor(floorDays)}d)`;
        overdueCount++;
      } else {
        const nextInDays = Math.max(0, floorDays - daysSince);
        health = `ok — next in ~${Math.floor(nextInDays)}d`;
      }
    }

    const cadenceStr = cadenceDays != null
      ? `${cadenceDays}d (${(src.cadenceConfidence ?? "?").toLowerCase()})`
      : "unknown";

    console.log([
      pad(src.name, 30),
      pad(src.publishStatus, 18),
      pad(fmtAge(lastScannedAt), 14),
      pad(cadenceStr, 12),
      health,
    ].join("  "));
  }

  console.log("-".repeat(header.length));
  console.log(`\n${sources.length} sources · ${overdueCount} overdue\n`);

  await prisma.$disconnect();
  process.exit(overdueCount > 0 ? 1 : 0);
})();
