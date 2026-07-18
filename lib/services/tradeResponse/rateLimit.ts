import { createHash } from "node:crypto";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Process-local abuse guard. Keys are hashes, so raw portal credentials are never retained. */
export function checkExternalRateLimit(token: string, clientHint = "unknown", now = Date.now()): boolean {
  const key = createHash("sha256").update(`${token}\0${clientHint}`).digest("hex");
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REQUESTS) return false;
  current.count += 1;
  return true;
}

export function resetExternalRateLimitsForTests(): void {
  buckets.clear();
}
