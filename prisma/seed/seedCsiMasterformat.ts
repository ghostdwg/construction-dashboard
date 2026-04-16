// Module CSI1 — Seed the CsiMasterformat table from the parsed JSON.
//
// Run: npx tsx prisma/seed/seedCsiMasterformat.ts
//
// Idempotent — uses upsert, safe to re-run after XLSX updates.

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

type Entry = {
  csiNumber: string;
  canonicalTitle: string;
  division: string;
};

async function main() {
  const jsonPath = path.join(__dirname, "csi_masterformat_seed.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `Seed data not found at ${jsonPath}. Run prisma/seed/parse_csi_masterformat.py first.`
    );
  }

  const entries = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Entry[];
  console.log(`[seedCsi] upserting ${entries.length} entries...`);

  let upserted = 0;
  for (const e of entries) {
    await prisma.csiMasterformat.upsert({
      where: { csiNumber: e.csiNumber },
      update: { canonicalTitle: e.canonicalTitle, division: e.division },
      create: e,
    });
    upserted++;
    if (upserted % 500 === 0) console.log(`[seedCsi]   ${upserted}...`);
  }

  const total = await prisma.csiMasterformat.count();
  const byDiv = await prisma.csiMasterformat.groupBy({
    by: ["division"],
    _count: true,
    orderBy: { division: "asc" },
  });

  console.log(`[seedCsi] done — ${total} total rows across ${byDiv.length} divisions`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
