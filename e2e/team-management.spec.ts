import { test, expect } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

async function seedConfiguration() {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey") VALUES ($1, $2, 'GLOBAL')
     ON CONFLICT ("singletonKey") DO NOTHING`,
    ["organisation", "TestOrg"]
  );
  await client.end();
}

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM team_member_snapshot");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM team");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

async function seedTeam(name: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO team (name) VALUES ($1) RETURNING id`,
    [name]
  );
  await client.end();
  return result.rows[0].id;
}

async function seedSeat(options: {
  githubUsername: string;
  githubUserId: number;
}): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status")
     VALUES ($1, $2, 'active')
     ON CONFLICT ("githubUsername") DO UPDATE SET status = 'active'
     RETURNING id`,
    [options.githubUsername, options.githubUserId]
  );
  await client.end();
  return result.rows[0].id;
}

async function seedMemberSnapshot(
  teamId: number,
  seatId: number,
  month: number,
  year: number,
) {
  const client = await getClient();
  await client.query(
    `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ON CONSTRAINT "UQ_team_member_snapshot" DO NOTHING`,
    [teamId, seatId, month, year]
  );
  await client.end();
}

async function seedUsage(
  seatId: number,
  day: number,
  month: number,
  year: number,
  usageItems: unknown[],
) {
  const client = await getClient();
  await client.query(
    `INSERT INTO copilot_usage ("seatId", "day", "month", "year", "usageItems")
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [seatId, day, month, year, JSON.stringify(usageItems)]
  );
  await client.end();
}

test.describe("Team Management", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("can navigate to Teams page via Management link", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await page.getByRole("link", { name: "Management" }).click();
    await page.waitForURL("**/management**", { timeout: 10000 });

    await page.getByRole("tab", { name: /project teams/i }).click();
    await expect(page).toHaveURL(/\/management\?tab=teams/);
    await expect(
      page.getByRole("tab", { name: /project teams/i, selected: true })
    ).toBeVisible();
  });

  test("shows empty state when no teams exist", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    await expect(
      page.getByText(/no teams found/i)
    ).toBeVisible();
  });

  test("team management table displays Usage % and Members columns", async ({ page }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const teamId = await seedTeam("Metrics Team");
    const seatId = await seedSeat({ githubUsername: "mgmt-user", githubUserId: 20001 });
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    // 150 AIC Units / (1 × 300) × 100 = 50%
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 150, grossAmount: 6.0, discountQuantity: 150, discountAmount: 6.0, netQuantity: 0, netAmount: 0 },
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Verify column headers
    const table = page.locator("table");
    await expect(table.getByRole("columnheader", { name: /members/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /usage %/i })).toBeVisible();

    // Verify row data
    const row = table.getByRole("row").filter({ hasText: "Metrics Team" });
    await expect(row).toContainText("Metrics Team");
    await expect(row).toContainText("1");
  });

  test("team with no members shows 0% usage", async ({ page }) => {
    await seedTeam("Lonely Team");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "Lonely Team" });
    await expect(row).toContainText("Lonely Team");
    await expect(row).toContainText("0");
  });

  test("can create a team and it appears in the list", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Click "Add Team" button
    await page.getByRole("button", { name: /add team/i }).click();

    // Modal dialog should be visible with overlay
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("modal-overlay")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /add new team/i })).toBeVisible();

    // Fill the create form within the modal
    await dialog.getByLabel(/team name/i).fill("Engineering");
    await dialog.getByRole("button", { name: /create team/i }).click();

    // Modal should close after successful creation
    await expect(dialog).not.toBeVisible();

    // Wait for the team to appear in the table
    const table = page.locator("table");
    await expect(table.getByText("Engineering")).toBeVisible();
  });

  test("cannot create a team with a duplicate name", async ({ page }) => {
    await seedTeam("Engineering");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Verify existing team is shown
    const table = page.locator("table");
    await expect(table.getByText("Engineering")).toBeVisible();

    // Try to create another team with the same name
    await page.getByRole("button", { name: /add team/i }).click();

    // Modal dialog should be visible
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("modal-overlay")).toBeVisible();

    await dialog.getByLabel(/team name/i).fill("Engineering");
    await dialog.getByRole("button", { name: /create team/i }).click();

    // Error should be shown inside the still-open modal
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/already exists/i)
    ).toBeVisible();
  });

  test("pressing Escape closes the create team modal without creating a team", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Open the create modal and fill in a name
    await page.getByRole("button", { name: /add team/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/team name/i).fill("GhostTeam");

    // Press Escape to dismiss
    await page.keyboard.press("Escape");

    // Modal should close
    await expect(dialog).not.toBeVisible();

    // No team should have been created
    await expect(page.getByText("GhostTeam")).not.toBeVisible();
  });

  test("clicking overlay closes the create team modal without creating a team", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Open the create modal and fill in a name
    await page.getByRole("button", { name: /add team/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/team name/i).fill("OverlayTeam");

    // Click on the overlay at the edge to dismiss
    const overlay = page.getByTestId("modal-overlay");
    await overlay.click({ position: { x: 10, y: 10 } });

    // Modal should close
    await expect(dialog).not.toBeVisible();

    // No team should have been created
    await expect(page.getByText("OverlayTeam")).not.toBeVisible();
  });

  test("clicking on a team name activates inline text input", async ({ page }) => {
    await seedTeam("ClickableTeam");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "ClickableTeam" });

    // Click the team name (rendered as a button by EditableTextCell)
    await row.getByRole("button", { name: /Edit name for team ClickableTeam/i }).click();

    // An input should appear with the current name (use table scope since row text filter breaks when name is in input value)
    const input = table.getByRole("textbox", { name: /Edit name for team ClickableTeam/i });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("ClickableTeam");
    await expect(input).toBeFocused();
  });

  test("pressing Enter saves the updated team name", async ({ page }) => {
    await seedTeam("OldName");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "OldName" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for team OldName/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for team OldName/i });
    await input.clear();
    await input.fill("NewName");
    await input.press("Enter");

    // Input should disappear, new name should show
    await expect(input).not.toBeVisible();
    await expect(table.getByText("NewName")).toBeVisible();
    await expect(table.getByText("OldName")).not.toBeVisible();
  });

  test("pressing Escape reverts team name without saving", async ({ page }) => {
    await seedTeam("KeepMe");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "KeepMe" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for team KeepMe/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for team KeepMe/i });
    await input.clear();
    await input.fill("ChangedName");
    await input.press("Escape");

    // Input should disappear, original name should remain
    await expect(input).not.toBeVisible();
    await expect(table.getByText("KeepMe")).toBeVisible();
    await expect(table.getByText("ChangedName")).not.toBeVisible();
  });

  test("clicking outside (blur) saves the updated team name", async ({ page }) => {
    await seedTeam("BlurTeam");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "BlurTeam" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for team BlurTeam/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for team BlurTeam/i });
    await input.clear();
    await input.fill("BlurSaved");

    // Click outside the input to trigger blur
    await page.locator("body").click();

    // New name should be visible (saved via blur)
    await expect(table.getByText("BlurSaved")).toBeVisible();
    await expect(table.getByText("BlurTeam")).not.toBeVisible();
  });

  test("clearing name to empty reverts to original (empty name prevented)", async ({ page }) => {
    await seedTeam("NonEmpty");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "NonEmpty" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for team NonEmpty/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for team NonEmpty/i });
    await input.clear();
    await input.press("Enter");

    // The original name should remain (empty name rejected)
    await expect(table.getByText("NonEmpty")).toBeVisible();
  });

  test("renaming to a duplicate name reverts to original", async ({ page }) => {
    await seedTeam("AlphaTeam");
    await seedTeam("BetaTeam");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "BetaTeam" });

    // Try to rename BetaTeam to AlphaTeam (duplicate)
    await row.getByRole("button", { name: /Edit name for team BetaTeam/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for team BetaTeam/i });
    await input.clear();
    await input.fill("AlphaTeam");
    await input.press("Enter");

    // Should revert — BetaTeam should still be visible
    await expect(table.getByText("BetaTeam")).toBeVisible();
    // Both teams should be present
    await expect(table.getByRole("row").filter({ hasText: "AlphaTeam" })).toHaveCount(1);
  });

  test("navigation icon links to team usage detail page", async ({ page }) => {
    const teamId = await seedTeam("NavTeam");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "NavTeam" });

    // Click the navigation arrow link
    const navLink = row.getByRole("link", { name: /view team usage/i });
    await expect(navLink).toBeVisible();
    await navLink.click();

    // Should navigate to the team usage detail page
    await page.waitForURL(`**/usage/teams/${teamId}`, { timeout: 10000 });
  });

  test("can delete a team with confirmation", async ({ page }) => {
    await seedTeam("ToDelete");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Verify team exists in the table first
    const table = page.locator("table");
    await expect(table.getByText("ToDelete")).toBeVisible();

    // Find the row and click Delete (use exact match to avoid matching EditableTextCell aria-label)
    const row = page.locator("tr", { hasText: "ToDelete" });
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    // Confirm deletion
    await expect(page.getByText(/are you sure/i)).toBeVisible();
    await page.getByRole("button", { name: /yes, delete/i }).click();

    // Team should disappear from the table
    await expect(table.getByText("ToDelete")).not.toBeVisible();
  });

  test("deleted team disappears from the list but DB row preserved", async ({
    page,
  }) => {
    const teamId = await seedTeam("SoftDeleted");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Delete via UI (use exact match to avoid matching EditableTextCell aria-label)
    const row = page.locator("tr", { hasText: "SoftDeleted" });
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: /yes, delete/i }).click();

    // Team should not be visible
    await expect(
      page.locator("table").getByText("SoftDeleted")
    ).not.toBeVisible();

    // Verify soft-delete in DB — row still exists with deletedAt set
    const client = await getClient();
    const result = await client.query(
      `SELECT "deletedAt" FROM team WHERE id = $1`,
      [teamId]
    );
    await client.end();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].deletedAt).not.toBeNull();
  });
});
