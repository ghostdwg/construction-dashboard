#!/usr/bin/env tsx
// Bootstrap a new user from the command line.
// Run: npx tsx scripts/create-user.ts --email=you@example.com --name="Jane" --role=estimator
//
// If --password is omitted a random 20-char temp password is generated and printed.
// Use this to bootstrap the first admin or to add team members before the UI ships.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function main() {
  const email    = arg("email");
  const name     = arg("name");
  const role     = arg("role") ?? "estimator";
  const password = arg("password") ?? crypto.randomBytes(10).toString("hex");

  if (!email) {
    console.error("Usage: npx tsx scripts/create-user.ts --email=<email> --name=<name> [--role=admin|estimator|pm] [--password=<pw>]");
    process.exit(1);
  }
  if (!name) {
    console.error("Error: --name is required");
    process.exit(1);
  }
  if (!["admin", "estimator", "pm"].includes(role)) {
    console.error("Error: --role must be admin, estimator, or pm");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name:  name.trim(),
        role,
        hashedPassword,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    console.log("\n✓ User created");
    console.log(`  ID:       ${user.id}`);
    console.log(`  Email:    ${user.email}`);
    console.log(`  Name:     ${user.name}`);
    console.log(`  Role:     ${user.role}`);
    if (!arg("password")) {
      console.log(`  Password: ${password}  ← share this, it is not stored in plaintext`);
    }
    console.log();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint") || msg.includes("unique")) {
      console.error(`Error: A user with email "${email}" already exists`);
    } else {
      console.error("Error creating user:", msg);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
