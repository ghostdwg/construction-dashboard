import { test, expect, type Page } from "@playwright/test";

// Keep in sync with e2e-auth/setup-db.mjs's seeded user. Not imported
// directly — that file is plain Node ESM and Playwright's test transform
// can't resolve its top-level `import.meta` usage.
const E2E_USER_EMAIL = "e2e-operator@example.test";
const E2E_USER_PASSWORD = "e2e-test-password-123";

// GWX-R1 operations-route-fix — authenticated regression coverage.
//
// e2e/navigation.spec.ts (playwright.config.ts) runs with AUTH_DISABLED=true,
// which returns from proxy.ts's auth() wrapper before its authenticated
// "/" → "/bids" landing redirect ever executes. That suite passing 22/22
// is exactly why the staging symptom — clicking "Operations" landing on the
// Projects workspace — looked "not reproducible from source" the first time
// this was investigated. It only reproduces once a real session exists, so
// this suite signs in through the actual credentials form.

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/bids$/);
}

test.describe("authenticated sidebar routing", () => {
  test("Projects resolves to /bids with the Projects heading", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/bids$/);
    await expect(page.locator("h1")).toHaveText("Projects");
  });

  test("Operations resolves to /operations with the Operations heading, not Projects", async ({ page }) => {
    await login(page);
    await page.locator('aside.gwx-rail a[href="/operations"]').click();
    await expect(page).toHaveURL(/\/operations$/);
    await expect(page.locator("h1")).toHaveText("Operations");
  });

  test("Operations and Projects resolve to different final URLs and headings", async ({ page }) => {
    await login(page);
    const projectsUrl = page.url();
    const projectsHeading = await page.locator("h1").textContent();

    await page.locator('aside.gwx-rail a[href="/operations"]').click();
    await expect(page).toHaveURL(/\/operations$/);

    expect(page.url()).not.toBe(projectsUrl);
    await expect(page.locator("h1")).not.toHaveText(projectsHeading ?? "Projects");
  });

  test("an authenticated visitor requesting bare / is redirected off it, never stranding Operations there", async ({ page }) => {
    await login(page);
    await page.goto("/");
    // proxy.ts's landing-page redirect sends authenticated "/" requests to
    // /bids — asserting it explicitly here so a future change to that
    // redirect target is forced to touch this suite, not just staging.
    await expect(page).toHaveURL(/\/bids$/);
  });
});
