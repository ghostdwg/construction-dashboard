#!/usr/bin/env npx tsx
// scripts/verify-anthropic-key.ts
//
// Verifies the Anthropic API key configured in the environment (or .env.local).
// Exits 0 on valid, non-zero otherwise.
//
// Reports: valid | invalid | rate_limited | missing
// Never logs the key value — only the result.
//
// Usage: npx tsx scripts/verify-anthropic-key.ts
//
// HUMAN-EXECUTED: this script makes a real Anthropic API call (~$0.0001).
// Per Ledger §6, operator approval is required before running against
// a paid key. The call uses the smallest available model with maxTokens=1.

import * as fs from "fs";
import * as path from "path";

// Load .env.local → .env in precedence order (Next.js convention).
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

type Result = "valid" | "invalid" | "rate_limited" | "missing";

async function verifyKey(): Promise<Result> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "missing";

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": key,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
  } catch {
    console.error("Network error — could not reach api.anthropic.com");
    return "invalid";
  }

  if (res.status === 200) return "valid";
  if (res.status === 401) return "invalid";
  if (res.status === 429) return "rate_limited";
  console.error(`Unexpected HTTP ${res.status}`);
  return "invalid";
}

(async () => {
  const result = await verifyKey();
  const icons: Record<Result, string> = {
    valid:        "✓",
    invalid:      "✗",
    rate_limited: "~",
    missing:      "!",
  };
  console.log(`ANTHROPIC_API_KEY: ${icons[result]} ${result}`);
  process.exit(result === "valid" ? 0 : 1);
})();
