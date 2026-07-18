import { test, expect, type Page } from "@playwright/test";

// Keep in sync with setup-db.mjs. Values are synthetic local fixtures.
const E2E_USER_EMAIL = "e2e-operator@example.test";
const E2E_USER_PASSWORD = "e2e-test-password-123";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/bids$/);
}

test.describe("authenticated global navigation", () => {
  test("Projects resolves to /bids with the Projects heading", async ({ page }) => {
    await login(page);
    await expect(page.locator("h1")).toHaveText("Projects");
  });

  test("Operations resolves to its own URL and dashboard", async ({ page }) => {
    await login(page);
    await page.locator('aside.gwx-rail a[href="/operations"]').click();
    await expect(page).toHaveURL(/\/operations$/);
    await expect(page.locator("h1")).toHaveText("Operations");
  });

  test("Operations and Projects remain distinct", async ({ page }) => {
    await login(page);
    const projectsUrl = page.url();
    const projectsHeading = await page.locator("h1").textContent();

    await page.locator('aside.gwx-rail a[href="/operations"]').click();
    await expect(page).toHaveURL(/\/operations$/);
    expect(page.url()).not.toBe(projectsUrl);
    await expect(page.locator("h1")).not.toHaveText(projectsHeading ?? "Projects");
  });

  test("authenticated bare root still redirects to Projects", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/bids$/);
  });
});
