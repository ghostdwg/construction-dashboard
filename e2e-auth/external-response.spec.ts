import { expect, test } from "@playwright/test";

const VALID_TOKEN = "e2e-valid-response-token";
const EXPIRED_TOKEN = "e2e-expired-response-token";
const REVOKED_TOKEN = "e2e-revoked-response-token";

function expectPrivateTokenResponse(response: { headers(): Record<string, string>; status(): number }) {
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("private, no-store");
  expect(headers["x-content-type-options"]).toBe("nosniff");
}

test.describe("sessionless contractor token boundary", () => {
  test("a valid token reaches the route token wall without an Auth.js session", async ({ page }) => {
    const response = await page.request.get(`/api/external/response/${VALID_TOKEN}`);
    expect(response.status()).toBe(200);
    expectPrivateTokenResponse(response);
    expect(await response.json()).toMatchObject({
      ok: true,
      package: { packageNumber: 1, title: "Synthetic token-wall package" },
    });
  });

  for (const [label, token] of [
    ["unknown", "e2e-unknown-response-token"],
    ["expired", EXPIRED_TOKEN],
    ["revoked", REVOKED_TOKEN],
  ] as const) {
    test(`${label} token gets the same private 404 without a session`, async ({ page }) => {
      const response = await page.request.get(`/api/external/response/${token}`);
      expect(response.status()).toBe(404);
      expectPrivateTokenResponse(response);
      expect(await response.json()).toEqual({ error: "Not found" });
    });
  }

  test("contractor rendering has no authenticated chrome or global counts", async ({ page }) => {
    await page.goto(`/external/response/${VALID_TOKEN}`);
    await expect(page.getByRole("heading", { name: /RP-1: Synthetic token-wall package/ })).toBeVisible();
    await expect(page.locator("aside.gwx-rail")).toHaveCount(0);
    await expect(page.getByText("E2E Operator")).toHaveCount(0);
    await expect(page.getByText("Active jobs", { exact: false })).toHaveCount(0);
    await expect(page.getByText("New signals", { exact: false })).toHaveCount(0);
  });

  test("unknown token renders the non-oracular unavailable state without app chrome", async ({ page }) => {
    await page.goto("/external/response/e2e-unknown-response-token");
    await expect(page.getByRole("heading", { name: "Response package not found" })).toBeVisible();
    await expect(page.locator("aside.gwx-rail")).toHaveCount(0);
  });

  test("the public landing page is data-free and outside authenticated chrome", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("public-landing")).toBeVisible();
    await expect(page.locator("aside.gwx-rail")).toHaveCount(0);
    await expect(page.getByText("E2E Operator")).toHaveCount(0);
  });

  test("segment-neighbor page and API routes remain session protected", async ({ page }) => {
    for (const path of ["/external/responses/token", "/external/responsex/token"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain("/?callbackUrl=");
    }
    for (const path of ["/api/external/responses/token", "/api/external/responsex/token"]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });
});
