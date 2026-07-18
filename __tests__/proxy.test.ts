import { describe, expect, it } from "vitest";

describe("proxy isPublicPath", async () => {
  const { isPublicPath } = await import("../lib/routing/publicPaths");

  it("allows the landing page and login form", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
  });

  it("allows the auth API, health check, and pre-existing operational exceptions", () => {
    expect(isPublicPath("/api/auth/callback/credentials")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/metrics")).toBe(true);
    expect(isPublicPath("/api/jobs/run-due")).toBe(true);
    expect(isPublicPath("/api/procore/webhook")).toBe(true);
  });

  it("allows Next.js internals and favicon", () => {
    expect(isPublicPath("/_next/static/chunk.js")).toBe(true);
    expect(isPublicPath("/favicon.ico")).toBe(true);
  });

  it("protects everything else", () => {
    expect(isPublicPath("/operations")).toBe(false);
    expect(isPublicPath("/bids")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/api/bids")).toBe(false);
    expect(isPublicPath("/api/health/nested")).toBe(false);
  });
});
