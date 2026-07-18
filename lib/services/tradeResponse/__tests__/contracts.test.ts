import { describe, expect, test } from "vitest";
import { derivePackageDisplayStatus, hashResponseToken } from "../packages";
import { checkExternalRateLimit, resetExternalRateLimitsForTests } from "../rateLimit";
import { responseAttachmentStorageKey, validateResponseAttachment } from "../storage";
import { assertResponseAccessTokenPatch, assertTradeResponseRevisionPatch } from "../immutability";

describe("R2 Build 2 pure security contracts", () => {
  test("SHA-256 token hashing is deterministic and never returns the raw token", () => {
    const raw = "synthetic-portal-token-only";
    const hash = hashResponseToken(raw);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(raw);
    expect(hashResponseToken(raw)).toBe(hash);
  });

  test("OVERDUE and NO_RESPONSE are derived and never replace stored status", () => {
    const now = new Date("2026-07-18T00:00:00Z");
    const due = new Date("2026-07-17T00:00:00Z");
    expect(derivePackageDisplayStatus({ status: "ISSUED", responseDueDate: due, itemCount: 2, respondedItemCount: 0 }, now)).toBe("NO_RESPONSE");
    expect(derivePackageDisplayStatus({ status: "ISSUED", responseDueDate: due, itemCount: 2, respondedItemCount: 1 }, now)).toBe("OVERDUE");
    expect(derivePackageDisplayStatus({ status: "GC_REVIEW", responseDueDate: due, itemCount: 2, respondedItemCount: 1 }, now)).toBe("GC_REVIEW");
  });

  test("attachment validation and storage paths are allowlisted, safe, and project/package scoped", () => {
    expect(validateResponseAttachment({ fileName: "site/photo?.png", mimeType: "image/png", byteSize: 4 })).toEqual({ ok: true, safeFileName: "photo_.png" });
    expect(validateResponseAttachment({ fileName: "x.svg", mimeType: "image/svg+xml", byteSize: 4 }).ok).toBe(false);
    expect(validateResponseAttachment({ fileName: "x.pdf", mimeType: "application/pdf", byteSize: 25 * 1024 * 1024 + 1 }).ok).toBe(false);
    expect(responseAttachmentStorageKey(7, 11, 13, "../unsafe.pdf", "server-nonce")).toBe("plan-room/jobs/7/response-packages/11/13-server-nonce-unsafe.pdf");
  });

  test("rate limiter retains only hashed bucket keys and closes after the bounded window count", () => {
    resetExternalRateLimitsForTests();
    for (let index = 0; index < 60; index += 1) expect(checkExternalRateLimit("synthetic", "client", 1)).toBe(true);
    expect(checkExternalRateLimit("synthetic", "client", 1)).toBe(false);
    expect(checkExternalRateLimit("synthetic", "client", 60_001)).toBe(true);
  });

  test("client-extension guards permit review/evidence stamps but reject response/token rewrites", () => {
    expect(() => assertTradeResponseRevisionPatch({ gcReview: "ACCEPTED_FOR_TRANSMITTAL", gcCommentary: "separate" })).not.toThrow();
    expect(() => assertTradeResponseRevisionPatch({ responseText: "rewrite" })).toThrow(/immutable/);
    expect(() => assertResponseAccessTokenPatch({ lastUsedAt: new Date() })).not.toThrow();
    expect(() => assertResponseAccessTokenPatch({ packageId: 999 })).toThrow(/immutable/);
  });
});
