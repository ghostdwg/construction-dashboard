import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const EXTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;
export const EXTERNAL_RATE_LIMIT_MAX_REQUESTS = 60;
const UNIQUE_RETRY_LIMIT = 3;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function bucketKey(knownTokenDigest: string | null): string {
  // The identity is derived by the server from a DB credential lookup. All
  // unknown token strings collapse into one bucket, so arbitrary paths cannot
  // allocate unbounded rows. No forwarding/client header is trusted.
  return createHash("sha256")
    .update(`trusted-route:external-response\0${knownTokenDigest ?? "unknown-credential"}`)
    .digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "P2002" || (typeof candidate.message === "string" && /unique constraint/i.test(candidate.message));
}

/**
 * Shared database-backed token-wall limiter.
 *
 * Rows expire after one minute and are deleted on consumption. The key uses
 * only a server-resolved non-secret token digest (or the singleton unknown identity),
 * never x-forwarded-for, caller-provided identity, or the raw token.
 */
export async function checkExternalRateLimit(rawToken: string, now = new Date()): Promise<boolean> {
  for (let attempt = 0; attempt < UNIQUE_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.externalResponseRateLimitBucket.deleteMany({ where: { expiresAt: { lte: now } } });
        const token = await tx.responseAccessToken.findUnique({
          where: { tokenHash: hashToken(rawToken) },
          select: { tokenHash: true },
        });
        const key = bucketKey(token?.tokenHash ?? null);
        const current = await tx.externalResponseRateLimitBucket.findUnique({ where: { key } });
        if (!current) {
          await tx.externalResponseRateLimitBucket.create({
            data: {
              key,
              requestCount: 1,
              windowStartedAt: now,
              expiresAt: new Date(now.getTime() + EXTERNAL_RATE_LIMIT_WINDOW_MS),
            },
          });
          return true;
        }
        if (current.requestCount >= EXTERNAL_RATE_LIMIT_MAX_REQUESTS) return false;
        const claimed = await tx.externalResponseRateLimitBucket.updateMany({
          where: {
            key,
            requestCount: current.requestCount,
            expiresAt: { gt: now },
          },
          data: { requestCount: { increment: 1 } },
        });
        if (claimed.count === 1) return true;
        throw Object.assign(new Error("rate-limit coordination conflict"), { code: "P2002" });
      });
    } catch (error) {
      if (!isUniqueConflict(error) || attempt === UNIQUE_RETRY_LIMIT - 1) throw error;
      await Promise.resolve();
    }
  }
  return false;
}

export const rateLimitInternalsForTests = { bucketKey };
