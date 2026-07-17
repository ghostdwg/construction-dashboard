import { test, expect, type Page, type Locator } from "@playwright/test";

// R2-B1 Meeting Register Foundation — end-to-end workflow suite.
//
// Exercises the full review loop over the fixture meeting seeded by
// e2e/setup-db.mjs (Bid 2 → "OAC Meeting #12"): register listing + coverage,
// type filtering, dispositions (confirm / dismiss-with-reason), the
// minutes publish gate, promotion into the Operations Register, minutes
// publication + amendment, transcript segment review with an audited
// EDIT_TEXT correction, and register-entry durability after promotion.
//
// Tests in this file are ORDER-DEPENDENT (workers=1, single sqlite fixture):
// each step advances the same meeting through its review lifecycle, exactly
// like a real session would.

async function openMeeting(page: Page): Promise<void> {
  await page.goto("/bids/2?tab=meetings");
  await page.getByRole("button", { name: /OAC Meeting #12/ }).click();
  // Detail has loaded once the section tabs render.
  await expect(sectionTab(page, "Register")).toBeVisible();
}

const sectionTab = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

const registerPanel = (page: Page) =>
  page.locator("section").filter({ hasText: "Meeting Register" });

const minutesPanel = (page: Page) =>
  page.locator("section").filter({ hasText: "Publishing freezes an immutable snapshot" });

const transcriptPanel = (page: Page) =>
  page.locator("section").filter({ hasText: "Transcript Review" });

const entryCard = (page: Page, text: string): Locator =>
  registerPanel(page).locator("ul > li").filter({ hasText: text });

async function openRegister(page: Page): Promise<void> {
  await openMeeting(page);
  await sectionTab(page, "Register").click();
  await expect(
    registerPanel(page).getByRole("heading", { name: /Meeting Register/ })
  ).toBeVisible();
}

async function openMinutes(page: Page): Promise<void> {
  await openMeeting(page);
  await sectionTab(page, "Minutes").click();
  await expect(
    minutesPanel(page).getByRole("heading", { name: /Minutes/ })
  ).toBeVisible();
}

test.describe("meeting register — listing and coverage", () => {
  test("register lists the 3 seeded entries with type badges and coverage chip", async ({ page }) => {
    await openRegister(page);
    const panel = registerPanel(page);

    await expect(panel.locator("ul > li")).toHaveCount(3);
    await expect(panel.getByText("Use terrazzo in lobby")).toBeVisible();
    await expect(panel.getByText("Deliver mockup panel by end of month")).toBeVisible();
    await expect(panel.getByText("Steel delivery slipped two weeks")).toBeVisible();

    // Type badges
    await expect(entryCard(page, "Use terrazzo in lobby").getByText("DECISION")).toBeVisible();
    await expect(
      entryCard(page, "Deliver mockup panel by end of month").getByText("COMMITMENT")
    ).toBeVisible();
    await expect(
      entryCard(page, "Steel delivery slipped two weeks").getByText("RISK")
    ).toBeVisible();

    // Coverage chip — every seeded entry is extracted and undispositioned.
    await expect(panel.getByText("3 of 3 extracted entries need review")).toBeVisible();
  });

  test("filtering by entry type narrows the list to the one DECISION", async ({ page }) => {
    await openRegister(page);
    const panel = registerPanel(page);
    await expect(panel.locator("ul > li")).toHaveCount(3);

    // First select is the entry-type filter (the second holds dispositions).
    await panel.locator("select").first().selectOption("DECISION");

    await expect(panel.locator("ul > li")).toHaveCount(1);
    await expect(panel.getByText("Use terrazzo in lobby")).toBeVisible();
    await expect(panel.getByText("Steel delivery slipped two weeks")).toHaveCount(0);
  });
});

test.describe("meeting register — dispositions", () => {
  test("confirming the DECISION entry sets its state chip to confirmed", async ({ page }) => {
    await openRegister(page);
    const card = entryCard(page, "Use terrazzo in lobby");

    await expect(card.getByText("pending")).toBeVisible();
    await card.getByRole("button", { name: "Confirm", exact: true }).click();

    await expect(card.getByText("confirmed")).toBeVisible();
    await expect(card.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
    // Coverage chip advances.
    await expect(
      registerPanel(page).getByText("2 of 3 extracted entries need review")
    ).toBeVisible();
  });

  test("dismissing the RISK entry requires a typed reason", async ({ page }) => {
    await openRegister(page);
    const card = entryCard(page, "Steel delivery slipped two weeks");

    await card.getByRole("button", { name: "Dismiss…" }).click();
    const submit = card.getByRole("button", { name: "Dismiss", exact: true });
    await expect(submit).toBeDisabled();

    await card.getByPlaceholder("reason (required)").fill("Duplicate of the schedule log entry");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(card.getByText("dismissed with reason")).toBeVisible();
  });
});

test.describe("minutes — publish gate while entries are pending", () => {
  test("publish is disabled with a warning banner while 1 entry is PENDING", async ({ page }) => {
    await openMinutes(page);
    const panel = minutesPanel(page);

    await expect(
      panel.getByText(/1 extracted register entry still need/)
    ).toBeVisible();

    const publish = panel.getByRole("button", { name: "Publish minutes" });
    await expect(publish).toBeDisabled();
    await expect(publish).toHaveAttribute(
      "title",
      "Disposition all extracted register entries first"
    );
  });
});

test.describe("meeting register — promotion to operations", () => {
  test("promoting the COMMITMENT creates a TrackedItem and keeps the entry", async ({ page }) => {
    await openRegister(page);
    const card = entryCard(page, "Deliver mockup panel by end of month");

    await card.getByRole("button", { name: "Promote to Operations…" }).click();
    await expect(card.getByPlaceholder("item title")).toHaveValue(
      "Deliver mockup panel by end of month"
    );
    await card.getByRole("button", { name: "Create item", exact: true }).click();

    await expect(card.getByText(/Operations Register: #\d+/)).toBeVisible();
    await expect(card.getByText("promoted to operations")).toBeVisible();
    // With every extracted entry dispositioned, the register is fully reviewed.
    await expect(
      registerPanel(page).getByText("fully reviewed (3 entries)")
    ).toBeVisible();
  });
});

test.describe("minutes — publication and amendment", () => {
  test("publishes revision 0, then an amendment with a required reason", async ({ page }) => {
    await openMinutes(page);
    const panel = minutesPanel(page);

    const publish = panel.getByRole("button", { name: "Publish minutes" });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(panel.getByText(/Revision 0 — original publication/)).toBeVisible();

    // Amendment path: reason is required before the button enables.
    const amend = panel.getByRole("button", { name: "Publish amendment" });
    await expect(amend).toBeDisabled();
    await panel
      .getByPlaceholder("amendment reason (required)")
      .fill("Clarified steel delivery schedule impact");
    await expect(amend).toBeEnabled();
    await amend.click();

    await expect(panel.getByText(/Revision 1 — amendment/)).toBeVisible();
    await expect(panel.getByText(/Revision 0 — original publication/)).toBeVisible();
  });
});

test.describe("transcript review — segments and corrections", () => {
  test("shows 3 segments with timestamps and applies an audited text edit", async ({ page }) => {
    await openMeeting(page);
    await sectionTab(page, "Transcript").click();
    const panel = transcriptPanel(page);

    await expect(panel.getByText("3 segments")).toBeVisible();
    for (const ts of ["00:05", "00:12", "00:30"]) {
      await expect(panel.getByText(ts, { exact: true })).toBeVisible();
    }

    const firstSegment = panel
      .locator("li")
      .filter({ hasText: "We will pour the deck Friday morning." })
      .first();
    await firstSegment.hover();
    await firstSegment.getByRole("button", { name: "edit", exact: true }).click();

    const editor = firstSegment.locator("textarea");
    await expect(editor).toHaveValue("We will pour the deck Friday morning.");
    await editor.fill("We will pour the deck Friday at 6 AM.");
    await firstSegment.getByRole("button", { name: "Apply", exact: true }).click();

    await expect(panel.getByText("We will pour the deck Friday at 6 AM.")).toBeVisible();
    await expect(panel.getByText("(edited)")).toBeVisible();
    await expect(panel.getByText(/correction history \(1\)/)).toBeVisible();
  });
});

test.describe("register durability", () => {
  test("all 3 entries survive dispositions and promotion", async ({ page }) => {
    await openRegister(page);
    const panel = registerPanel(page);

    await expect(panel.locator("ul > li")).toHaveCount(3);
    await expect(panel.getByText("Use terrazzo in lobby")).toBeVisible();
    await expect(panel.getByText("Steel delivery slipped two weeks")).toBeVisible();
    const promoted = entryCard(page, "Deliver mockup panel by end of month");
    await expect(promoted.getByText(/Operations Register: #\d+/)).toBeVisible();
    await expect(promoted.getByText("promoted to operations")).toBeVisible();
  });
});
