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

async function seedSeat(
  githubUsername: string,
  firstName: string | null = null,
  lastName: string | null = null
): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName")
     VALUES ($1, $2, 'active', $3, $4)
     RETURNING id`,
    [githubUsername, Math.floor(Math.random() * 100000), firstName, lastName]
  );
  await client.end();
  return result.rows[0].id;
}

test.describe("Team Member Management", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("can view members panel for a team (shows empty state)", async ({
    page,
  }) => {
    await seedTeam("Engineering");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Click Members button on the Engineering team row
    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    // Members panel should appear with "Members of Engineering" heading
    await expect(
      page.getByRole("heading", { name: /members of engineering/i })
    ).toBeVisible();

    // Should show empty state
    await expect(page.getByText(/no members/i)).toBeVisible();
  });

  test("can add one or more seats to a team", async ({ page }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");
    await seedSeat("bob", "Bob", "Jones");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Open members modal
    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /members of engineering/i })
    ).toBeVisible();

    // Click Add Members button at top of modal
    await dialog.getByRole("button", { name: /add members/i }).click();
    await expect(dialog.getByRole("heading", { name: /add members/i })).toBeVisible();
    await expect(dialog.getByLabel(/cost allocation %/i)).toHaveValue("100");

    // Should see available seats with checkboxes
    await expect(dialog.getByLabel(/select alice/i)).toBeVisible();
    await expect(dialog.getByLabel(/select bob/i)).toBeVisible();

    await dialog.getByLabel(/cost allocation %/i).fill("60");

    // Select both seats
    await dialog.getByLabel(/select alice/i).check();
    await dialog.getByLabel(/select bob/i).check();

    // Click "Add Selected"
    await dialog.getByRole("button", { name: /add selected/i }).click();

    // Form should hide on success but modal stays open
    await expect(dialog.getByRole("heading", { name: /add members/i })).not.toBeVisible();
    await expect(dialog).toBeVisible();

    // Members should now appear in the table within the modal
    const membersTable = dialog.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    const aliceRow = membersTable.locator("tr", { hasText: "alice" });
    const bobRow = membersTable.locator("tr", { hasText: "bob" });

    await expect(aliceRow.getByRole("cell", { name: "alice", exact: true })).toBeVisible();
    await expect(bobRow.getByRole("cell", { name: "bob", exact: true })).toBeVisible();
    await expect(aliceRow.getByText("60%")).toBeVisible();
    await expect(bobRow.getByText("60%")).toBeVisible();
  });

  test("can edit a member allocation for the selected month", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year", "allocationPercentage") VALUES ($1, $2, $3, $4, 100)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const membersTable = page.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    const memberRow = membersTable.locator("tr", { hasText: "alice" });
    await expect(memberRow.getByText("100%")).toBeVisible();

    await memberRow.getByRole("button", { name: /edit allocation/i }).click();
    await memberRow.getByRole("spinbutton").fill("80");
    await memberRow.getByRole("button", { name: /^save$/i }).click();

    await expect(memberRow.getByText("80%")).toBeVisible();
  });

  test("can remove a seat from a team", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    // Seed the member snapshot directly
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Open members panel
    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    // Verify alice is listed
    const membersTable = page.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    await expect(membersTable.getByRole("cell", { name: "alice", exact: true })).toBeVisible();

    // Click Remove on alice's row
    const memberRow = membersTable.locator("tr", { hasText: "alice" });
    await memberRow.getByRole("button", { name: /remove/i }).click();

    // Should see Retire / Purge / Cancel options
    await expect(memberRow.getByRole("button", { name: /retire/i })).toBeVisible();
    await expect(memberRow.getByRole("button", { name: /purge/i })).toBeVisible();
    await expect(memberRow.getByRole("button", { name: /cancel/i })).toBeVisible();

    // Click Retire
    await memberRow.getByRole("button", { name: /retire/i }).click();

    // alice should disappear
    await expect(membersTable.getByRole("cell", { name: "alice", exact: true })).not.toBeVisible();

    // Should show empty state
    await expect(page.getByText(/no members/i)).toBeVisible();
  });

  test("retire removes current month only, preserving historical snapshots", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    // Seed current month and a historical month
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4), ($1, $2, 1, 2024)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const membersTable = page.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    const memberRow = membersTable.locator("tr", { hasText: "alice" });
    await memberRow.getByRole("button", { name: /remove/i }).click();
    await memberRow.getByRole("button", { name: /retire/i }).click();

    // alice should disappear from current month view
    await expect(membersTable.getByRole("cell", { name: "alice", exact: true })).not.toBeVisible();

    // Verify historical snapshot preserved via DB
    const verifyClient = await getClient();
    const result = await verifyClient.query(
      `SELECT COUNT(*) AS count FROM team_member_snapshot WHERE "teamId" = $1 AND "seatId" = $2`,
      [teamId, seatId]
    );
    await verifyClient.end();
    expect(Number(result.rows[0].count)).toBe(1); // Only the historical one remains
  });

  test("purge flow shows impact count and requires explicit confirmation", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4), ($1, $2, 1, 2024), ($1, $2, 2, 2024)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const membersTable = page.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    const memberRow = membersTable.locator("tr", { hasText: "alice" });
    await memberRow.getByRole("button", { name: /remove/i }).click();

    // Click Purge to enter confirmation step
    await memberRow.getByRole("button", { name: /^purge$/i }).click();

    // Should show impact message with 3 months
    await expect(memberRow.getByText(/3 months/i)).toBeVisible();
    await expect(memberRow.getByRole("button", { name: /confirm purge/i })).toBeVisible();
    await expect(memberRow.getByRole("button", { name: /cancel/i })).toBeVisible();
  });

  test("purge removes member from ALL months", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4), ($1, $2, 1, 2024), ($1, $2, 2, 2024)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const membersTable = page.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    const memberRow = membersTable.locator("tr", { hasText: "alice" });
    await memberRow.getByRole("button", { name: /remove/i }).click();
    await memberRow.getByRole("button", { name: /^purge$/i }).click();

    // Wait for impact message then confirm
    await expect(memberRow.getByText(/3 months/i)).toBeVisible();
    await memberRow.getByRole("button", { name: /confirm purge/i }).click();

    // alice should disappear
    await expect(membersTable.getByRole("cell", { name: "alice", exact: true })).not.toBeVisible();

    // Verify ALL snapshots deleted via DB
    const verifyClient = await getClient();
    const result = await verifyClient.query(
      `SELECT COUNT(*) AS count FROM team_member_snapshot WHERE "teamId" = $1 AND "seatId" = $2`,
      [teamId, seatId]
    );
    await verifyClient.end();
    expect(Number(result.rows[0].count)).toBe(0);
  });

  test("cancelling purge confirmation returns to normal state", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const membersTable = page.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    const memberRow = membersTable.locator("tr", { hasText: "alice" });
    await memberRow.getByRole("button", { name: /remove/i }).click();

    // Enter purge confirmation
    await memberRow.getByRole("button", { name: /^purge$/i }).click();
    await expect(memberRow.getByRole("button", { name: /confirm purge/i })).toBeVisible();

    // Cancel
    await memberRow.getByRole("button", { name: /cancel/i }).click();

    // Should be back to normal state with Remove button
    await expect(memberRow.getByRole("button", { name: /remove/i })).toBeVisible();

    // alice should still be there
    await expect(membersTable.getByRole("cell", { name: "alice", exact: true })).toBeVisible();
  });

  test("a seat can belong to multiple teams", async ({ page }) => {
    await seedTeam("Engineering");
    await seedTeam("Frontend");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Add alice to Engineering
    const engRow = page.locator("tr", { hasText: "Engineering" });
    await engRow.getByRole("button", { name: /members/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /add members/i }).click();
    await dialog.getByLabel(/select alice/i).check();
    await dialog.getByRole("button", { name: /add selected/i }).click();

    // Verify alice is listed in Engineering within the modal
    const engMembersTable = dialog.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    await expect(engMembersTable.getByRole("cell", { name: "alice", exact: true })).toBeVisible();

    // Close modal via Escape
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Add alice to Frontend
    const frontendRow = page.locator("tr", { hasText: "Frontend" });
    await frontendRow.getByRole("button", { name: /members/i }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /add members/i }).click();
    await dialog.getByLabel(/select alice/i).check();
    await dialog.getByRole("button", { name: /add selected/i }).click();

    // Verify alice is listed in Frontend within the modal
    const frontendMembersTable = dialog.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    await expect(frontendMembersTable.getByRole("cell", { name: "alice", exact: true })).toBeVisible();

    // Verify in DB that alice is in both teams
    const client = await getClient();
    const result = await client.query(
      `SELECT COUNT(DISTINCT "teamId") as team_count FROM team_member_snapshot WHERE "seatId" = $1`,
      [seatId]
    );
    await client.end();
    expect(Number(result.rows[0].team_count)).toBe(2);
  });

  test("already-assigned seat is handled gracefully", async ({ page }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    // Pre-assign alice to Engineering
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4)`,
      [teamId, seatId, month, year]
    );
    await client.end();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Open members modal
    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Verify alice is listed
    const membersTable = dialog.locator("table", {
      has: page.locator("th", { hasText: /github username/i }),
    });
    await expect(membersTable.getByRole("cell", { name: "alice", exact: true })).toBeVisible();

    // Click Add Members directly within the modal
    await dialog.getByRole("button", { name: /add members/i }).click();

    // alice is the only active seat and already assigned — should see message
    await expect(
      dialog.getByText(/all active seats are already assigned/i)
    ).toBeVisible();
  });
});

test.describe("Team Member Backfill History", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  async function openBackfillFlow(page: import("@playwright/test").Page, teamName: string) {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: teamName });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click Backfill History toggle button
    await dialog.getByRole("button", { name: /backfill history/i }).click();

    // Wait for form heading
    await expect(
      dialog.getByRole("heading", { name: /backfill history/i })
    ).toBeVisible();

    return dialog;
  }

  test("can open backfill flow, select date range and seats, submit, and see success message", async ({
    page,
  }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    const dialog = await openBackfillFlow(page, "Engineering");

    // Set date range to a past month
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();
    // Use last month (handle January → December of previous year)
    const pastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const pastYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await dialog.locator("#backfill-start-month").selectOption(String(pastMonth));
    await dialog.locator("#backfill-start-year").selectOption(String(pastYear));
    await dialog.locator("#backfill-end-month").selectOption(String(pastMonth));
    await dialog.locator("#backfill-end-year").selectOption(String(pastYear));

    // Select alice
    await dialog.getByLabel(/select alice/i).check();

    // Click backfill submit
    await dialog.getByRole("button", { name: /backfill selected/i }).click();

    // Should see success message within the dialog
    await expect(
      dialog.getByText(/added 1 snapshot across 1 month/i)
    ).toBeVisible();

    // Verify in DB
    const client = await getClient();
    const result = await client.query(
      `SELECT COUNT(*)::text AS count FROM team_member_snapshot WHERE month = $1 AND year = $2`,
      [pastMonth, pastYear]
    );
    await client.end();
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  test("backfill across multiple months creates snapshots for each month", async ({
    page,
  }) => {
    const teamId = await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    const dialog = await openBackfillFlow(page, "Engineering");

    // Use 3 past months
    const now = new Date();
    const endVal = (now.getUTCFullYear() - 1) * 12 + 3; // March of last year
    const startVal = (now.getUTCFullYear() - 1) * 12 + 1; // January of last year

    const startMonth = ((startVal - 1) % 12) + 1;
    const startYear = Math.ceil(startVal / 12);
    const endMonth = ((endVal - 1) % 12) + 1;
    const endYear = Math.ceil(endVal / 12);

    await dialog.locator("#backfill-start-month").selectOption(String(startMonth));
    await dialog.locator("#backfill-start-year").selectOption(String(startYear));
    await dialog.locator("#backfill-end-month").selectOption(String(endMonth));
    await dialog.locator("#backfill-end-year").selectOption(String(endYear));

    await dialog.getByLabel(/select alice/i).check();
    await dialog.getByRole("button", { name: /backfill selected/i }).click();

    // Should indicate 3 months
    await expect(
      dialog.getByText(/added 3 snapshots across 3 months/i)
    ).toBeVisible();

    // Verify in DB
    const client = await getClient();
    const result = await client.query(
      `SELECT COUNT(*)::text AS count FROM team_member_snapshot WHERE "teamId" = $1`,
      [teamId]
    );
    await client.end();
    expect(Number(result.rows[0].count)).toBe(3);
  });

  test("shows validation error when start date is after end date", async ({
    page,
  }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    const dialog = await openBackfillFlow(page, "Engineering");

    // Set start after end
    const lastYear = new Date().getUTCFullYear() - 1;
    await dialog.locator("#backfill-start-month").selectOption("6"); // June
    await dialog.locator("#backfill-start-year").selectOption(String(lastYear));
    await dialog.locator("#backfill-end-month").selectOption("3"); // March
    await dialog.locator("#backfill-end-year").selectOption(String(lastYear));

    // Should see validation error within the dialog
    await expect(
      dialog.getByText(/start date must be before or equal to end date/i)
    ).toBeVisible();

    // Submit button should be disabled
    await dialog.getByLabel(/select alice/i).check();
    const submitBtn = dialog.getByRole("button", { name: /backfill selected/i });
    await expect(submitBtn).toBeDisabled();
  });

  test("shows validation error when end date is in the future", async ({
    page,
  }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    const dialog = await openBackfillFlow(page, "Engineering");

    const now = new Date();
    const futureMonth = now.getUTCMonth() + 1 === 12 ? 1 : now.getUTCMonth() + 2;
    const futureYear = now.getUTCMonth() + 1 === 12 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();

    await dialog.locator("#backfill-start-month").selectOption(String(now.getUTCMonth() + 1));
    await dialog.locator("#backfill-start-year").selectOption(String(now.getUTCFullYear()));
    await dialog.locator("#backfill-end-month").selectOption(String(futureMonth));
    await dialog.locator("#backfill-end-year").selectOption(String(futureYear));

    await expect(
      dialog.getByText(/end date cannot be in the future/i)
    ).toBeVisible();

    await dialog.getByLabel(/select alice/i).check();
    const submitBtn = dialog.getByRole("button", { name: /backfill selected/i });
    await expect(submitBtn).toBeDisabled();
  });

  test("backfill is idempotent — re-submitting same range shows added: 0", async ({
    page,
  }) => {
    const teamId = await seedTeam("Engineering");
    const seatId = await seedSeat("alice", "Alice", "Smith");

    // Pre-seed a snapshot for last month
    const now = new Date();
    const pastMonth = now.getUTCMonth() + 1 === 1 ? 12 : now.getUTCMonth();
    const pastYear = now.getUTCMonth() + 1 === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

    const client = await getClient();
    await client.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year") VALUES ($1, $2, $3, $4)`,
      [teamId, seatId, pastMonth, pastYear]
    );
    await client.end();

    const dialog = await openBackfillFlow(page, "Engineering");

    await dialog.locator("#backfill-start-month").selectOption(String(pastMonth));
    await dialog.locator("#backfill-start-year").selectOption(String(pastYear));
    await dialog.locator("#backfill-end-month").selectOption(String(pastMonth));
    await dialog.locator("#backfill-end-year").selectOption(String(pastYear));

    await dialog.getByLabel(/select alice/i).check();
    await dialog.getByRole("button", { name: /backfill selected/i }).click();

    // Should succeed but with 0 added
    await expect(
      dialog.getByText(/added 0 snapshots across 1 month/i)
    ).toBeVisible();
  });

  test("pressing Escape closes the modal while backfill form is active", async ({ page }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    const dialog = await openBackfillFlow(page, "Engineering");

    // Press Escape to close the modal
    await page.keyboard.press("Escape");

    // Dialog should be gone
    await expect(dialog).not.toBeVisible();
  });

  test("switching to backfill mode from add mode resets add form state", async ({ page }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Select Add Members mode
    await dialog.getByRole("button", { name: /add members/i }).click();

    // Verify add form is visible and select a seat
    await expect(dialog.getByLabel(/select alice/i)).toBeVisible();
    await dialog.getByLabel(/select alice/i).check();

    // Switch to Backfill History mode
    await dialog.getByRole("button", { name: /backfill history/i }).click();

    // Backfill form should be visible with date selectors
    await expect(
      dialog.getByRole("heading", { name: /backfill history/i })
    ).toBeVisible();
    await expect(dialog.locator("#backfill-start-month")).toBeVisible();

    // The backfill form's alice checkbox should be unchecked (fresh form state)
    await expect(dialog.getByLabel(/select alice/i)).not.toBeChecked();
  });

  test("pressing Escape closes the members modal without performing any action", async ({ page }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Activate Add Members mode
    await dialog.getByRole("button", { name: /add members/i }).click();
    await expect(dialog.getByLabel(/select alice/i)).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");

    // Dialog should be gone
    await expect(dialog).not.toBeVisible();

    // Reopen modal to verify clean state (no error persists)
    await row.getByRole("button", { name: /members/i }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/no members/i)).toBeVisible();
  });

  test("clicking overlay closes the members modal without performing any action", async ({ page }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click overlay at edge
    const overlay = page.getByTestId("modal-overlay");
    await overlay.click({ position: { x: 5, y: 5 } });

    // Dialog should be gone
    await expect(dialog).not.toBeVisible();
  });

  test("switching from backfill to add mode resets backfill form state", async ({ page }) => {
    await seedTeam("Engineering");
    await seedSeat("alice", "Alice", "Smith");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    const row = page.locator("tr", { hasText: "Engineering" });
    await row.getByRole("button", { name: /members/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Select Backfill History mode
    await dialog.getByRole("button", { name: /backfill history/i }).click();

    // Change dates to non-defaults
    const lastYear = new Date().getUTCFullYear() - 1;
    await dialog.locator("#backfill-start-month").selectOption("6");
    await dialog.locator("#backfill-start-year").selectOption(String(lastYear));

    // Switch to Add Members mode
    await dialog.getByRole("button", { name: /add members/i }).click();

    // Switch back to Backfill History mode
    await dialog.getByRole("button", { name: /backfill history/i }).click();

    // Dates should be reset to defaults (current month/year)
    const now = new Date();
    const expectedMonth = String(now.getUTCMonth() + 1);
    const expectedYear = String(now.getUTCFullYear());

    await expect(dialog.locator("#backfill-start-month")).toHaveValue(expectedMonth);
    await expect(dialog.locator("#backfill-start-year")).toHaveValue(expectedYear);
  });
});
