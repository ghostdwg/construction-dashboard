import { test, expect, type Page } from "@playwright/test";

// GWX-R1 staging navigation recovery — end-to-end regression suite.
//
// Covers the full click-through matrix that the static guards in
// __tests__/navRecovery.test.ts cannot: real navigation in collapsed and
// expanded rail states, per-bid links keeping their bid id, the mobile
// drawer lifecycle, keyboard activation, active-route styling, decorative
// overlays, and the double-offset layout regression itself.
//
// Runs only against the local fixture server defined in playwright.config.ts.

const NAV_ITEMS = [
  { label: "Operations", href: "/" },
  { label: "Market Intelligence", href: "/market-intelligence" },
  { label: "Projects", href: "/bids" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Tasks", href: "/tasks" },
  { label: "Settings", href: "/settings" },
];

const railLink = (page: Page, href: string) =>
  page.locator(`aside.gwx-rail a[href="${href}"]`);

test.describe("global rail — hrefs and desktop navigation", () => {
  test("every primary sidebar item renders with the correct href", async ({ page }) => {
    await page.goto("/");
    for (const item of NAV_ITEMS) {
      await expect(railLink(page, item.href)).toHaveCount(1);
    }
  });

  for (const item of NAV_ITEMS) {
    test(`collapsed rail navigates to ${item.href}`, async ({ page }) => {
      await page.goto(item.href === "/" ? "/bids" : "/");
      // Approach the icon directly without settling on the rail first.
      await page.mouse.move(720, 450);
      await railLink(page, item.href).click();
      await expect(page).toHaveURL(
        item.href === "/" ? /\/$/ : new RegExp(`${item.href.replace(/\//g, "\\/")}`)
      );
    });
  }

  test("hover-expanded rail navigates and labels are visible", async ({ page }) => {
    await page.goto("/");
    const rail = page.locator("aside.gwx-rail");
    await rail.hover();
    // Expansion animates 64→240 over 200ms.
    await expect.poll(async () => (await rail.boundingBox())?.width).toBeGreaterThan(200);
    const label = railLink(page, "/bids").locator("span").first();
    await expect(label).toHaveCSS("opacity", "1");
    await railLink(page, "/bids").click();
    await expect(page).toHaveURL(/\/bids$/);
  });

  test("active-route styling follows navigation", async ({ page }) => {
    await page.goto("/");
    await railLink(page, "/tasks").click();
    await expect(page).toHaveURL(/\/tasks/);
    // Active link: 3px accent left border (inactive links use transparent).
    await expect
      .poll(async () =>
        railLink(page, "/tasks").evaluate((el) => getComputedStyle(el).borderLeftColor)
      )
      .not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/);
    // The link we navigated away from must not be styled active.
    const opsBorder = await railLink(page, "/").evaluate(
      (el) => getComputedStyle(el).borderLeftColor
    );
    expect(opsBorder).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/);
  });

  test("keyboard activation: focused link + Enter navigates, focus is visible", async ({ page }) => {
    await page.goto("/");
    const link = railLink(page, "/bids");
    await link.focus();
    const focusVisible = await link.evaluate((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle !== "none" || s.boxShadow !== "none";
    });
    expect(focusVisible).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/bids$/);
  });
});

test.describe("layout regression — no double sidebar offset", () => {
  test("main content sits flush against the rail, collapsed and hovered", async ({ page }) => {
    await page.goto("/");
    const gap = () =>
      page.evaluate(() => {
        const aside = document.querySelector("aside.gwx-rail")!.getBoundingClientRect();
        const main = document.querySelector("main")!.getBoundingClientRect();
        return main.left - aside.right;
      });
    expect(await gap()).toBe(0);
    await page.locator("aside.gwx-rail").hover();
    await expect
      .poll(async () => (await page.locator("aside.gwx-rail").boundingBox())?.width)
      .toBeGreaterThan(200);
    expect(await gap()).toBe(0);
  });

  test("decorative body grid overlay does not capture pointer events", async ({ page }) => {
    await page.goto("/");
    const pe = await page.evaluate(
      () => getComputedStyle(document.body, "::before").pointerEvents
    );
    expect(pe).toBe("none");
  });
});

test.describe("per-bid navigation keeps the bid id", () => {
  const phases = [
    { label: "Pursuit", tab: "documents" },
    { label: "Coordination", tab: "handoff" },
    { label: "Field", tab: "operations" },
    { label: "Closeout", tab: "closeout" },
    { label: "Reference", tab: "warranties" },
  ];

  for (const phase of phases) {
    test(`bid 1 phase link → ?tab=${phase.tab}`, async ({ page }) => {
      await page.goto("/bids/1?tab=overview");
      await page.locator(`a[href="/bids/1?tab=${phase.tab}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/bids/1\\?tab=${phase.tab}`));
    });
  }

  test("awarded PROJECT (bid 2) hides pursuit and keeps its own id", async ({ page }) => {
    await page.goto("/bids/2?tab=overview");
    await expect(page.locator('a[href="/bids/2?tab=documents"]')).toHaveCount(0);
    await page.locator('a[href="/bids/2?tab=handoff"]').first().click();
    await expect(page).toHaveURL(/\/bids\/2\?tab=handoff/);
  });

  test("← Projects backlink returns to /bids", async ({ page }) => {
    await page.goto("/bids/1?tab=overview");
    await page.locator('a[href="/bids"]').first().click();
    await expect(page).toHaveURL(/\/bids$/);
  });
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("main content carries no sidebar margin on mobile", async ({ page }) => {
    await page.goto("/");
    const margin = await page.evaluate(
      () => getComputedStyle(document.querySelector("main")!).marginLeft
    );
    expect(margin).toBe("0px");
  });

  test("drawer opens, navigates, and closes on route change", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[aria-label="Open navigation"]').click();
    const link = railLink(page, "/bids");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/bids$/);
    await expect
      .poll(() =>
        page.evaluate(
          () => !document.querySelector("aside.gwx-rail")?.classList.contains("gwx-rail-open")
        )
      )
      .toBe(true);
  });

  test("backdrop click closes the drawer without navigating", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[aria-label="Open navigation"]').click();
    await expect(page.locator("aside.gwx-rail")).toHaveClass(/gwx-rail-open/);
    await page
      .locator('div[aria-hidden="true"].fixed.inset-0')
      .click({ position: { x: 350, y: 500 } });
    await expect(page.locator("aside.gwx-rail")).not.toHaveClass(/gwx-rail-open/);
    await expect(page).toHaveURL(/\/$/);
  });
});
