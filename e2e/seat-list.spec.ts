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

async function seedJobExecution(
  jobType: string,
  status: string,
  startedAt: string,
  completedAt: string | null = null,
  errorMessage: string | null = null,
  recordsProcessed: number | null = null
) {
  const client = await getClient();
  await client.query(
    `INSERT INTO job_execution ("jobType", "status", "startedAt", "completedAt", "errorMessage", "recordsProcessed")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [jobType, status, startedAt, completedAt, errorMessage, recordsProcessed]
  );
  await client.end();
}

interface SeedSeatOptions {
  githubUsername: string;
  githubUserId: number;
  status?: "active" | "inactive";
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  lastActivityAt?: string | null;
}

async function seedSeat(options: SeedSeatOptions) {
  const client = await getClient();
  await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "department", "lastActivityAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("githubUsername") DO NOTHING`,
    [
      options.githubUsername,
      options.githubUserId,
      options.status ?? "active",
      options.firstName ?? null,
      options.lastName ?? null,
      options.department ?? null,
      options.lastActivityAt ?? null,
    ]
  );
  await client.end();
}

async function seedMultipleSeats(count: number) {
  const client = await getClient();
  for (let i = 1; i <= count; i++) {
    const username = `user-${String(i).padStart(3, "0")}`;
    await client.query(
      `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "department")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("githubUsername") DO NOTHING`,
      [username, i, "active", `First${i}`, `Last${i}`, "Engineering"]
    );
  }
  await client.end();
}

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM job_execution");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Seat List", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("user navigates to /management?tab=seats and sees the tab active", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
  });

  test("Management navigation link navigates to management and Seats tab is accessible", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const managementLink = page.getByRole("link", { name: "Management" });
    await expect(managementLink).toBeVisible();
    await managementLink.click();

    await page.waitForURL("**/management**", { timeout: 10000 });

    // Click the Seats tab
    await page.getByRole("tab", { name: /seats/i }).click();
    await expect(page).toHaveURL(/\/management\?tab=seats/);
    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
  });

  test("empty state is displayed when no seats exist", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(
      page.getByText(/no seats have been synced yet/i)
    ).toBeVisible();
  });

  test("seat table displays seeded seat data", async ({ page }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      status: "active",
      firstName: "Octo",
      lastName: "Cat",
      department: "Engineering",
      lastActivityAt: "2024-06-15T12:00:00.000Z",
    });
    await seedSeat({
      githubUsername: "devuser",
      githubUserId: 2,
      status: "active",
      firstName: "Dev",
      lastName: "User",
      department: "Product",
    });
    await seedSeat({
      githubUsername: "inactiveuser",
      githubUserId: 3,
      status: "inactive",
      firstName: null,
      lastName: null,
      department: null,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    // Verify seat data is displayed
    await expect(table.getByText("octocat")).toBeVisible();
    await expect(table.getByText("devuser")).toBeVisible();
    await expect(table.getByText("inactiveuser")).toBeVisible();

    // Verify enrichment fields (now inside inline-editable cell buttons)
    const octocatRow = table.locator("tr", { hasText: "octocat" });
    await expect(octocatRow.getByRole("button", { name: /Edit first name/i })).toHaveText("Octo");
    await expect(octocatRow.getByRole("button", { name: /Edit department/i })).toHaveText("Engineering");
    const devRow = table.locator("tr", { hasText: "devuser" });
    await expect(devRow.getByRole("button", { name: /Edit department/i })).toHaveText("Product");

    // Verify AIC Units header is present
    await expect(table.getByRole("columnheader", { name: "AIC Units" })).toBeVisible();

    // Inactive seat should show the current AI credits value for inactive seats
    const inactiveRow = page.locator("tr", { hasText: "inactiveuser" });
    await expect(inactiveRow.getByText("0")).toBeVisible();
  });

  test("inactive seat displays correct status badge", async ({ page }) => {
    await seedSeat({
      githubUsername: "inactiveuser",
      githubUserId: 10,
      status: "inactive",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    // The inactive badge should be visible in the row
    const inactiveRow = page.locator("tr", { hasText: "inactiveuser" });
    await expect(inactiveRow.getByLabel("Status: Inactive")).toBeVisible();
  });

  test("pagination controls work with multiple pages", async ({ page }) => {
    // Seed 105 seats — default page size is 100, so this creates 2 pages
    await seedMultipleSeats(105);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    // Should show page 1 with pagination info
    await expect(page.getByText(/page 1 of 2/i)).toBeVisible();
    await expect(page.getByText(/showing 1–100 of 105 seats/i)).toBeVisible();

    // Previous should be disabled on page 1
    const prevButton = page.getByRole("button", { name: "Previous", exact: true });
    await expect(prevButton).toBeDisabled();

    // Next should be enabled
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    await expect(nextButton).toBeEnabled();

    // Navigate to page 2
    await nextButton.click();

    await expect(page.getByText(/page 2 of 2/i)).toBeVisible();
    await expect(page.getByText(/showing 101–105 of 105 seats/i)).toBeVisible();

    // Next should be disabled on last page
    await expect(nextButton).toBeDisabled();

    // Previous should now be enabled
    await expect(prevButton).toBeEnabled();

    // Navigate back to page 1
    await prevButton.click();

    await expect(page.getByText(/page 1 of 2/i)).toBeVisible();
  });
});

test.describe("Job Status Cards on Seats Tab", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("shows the Seat Sync card with 'No runs recorded yet' when no executions exist", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const seatSyncCard = page
      .getByRole("article")
      .filter({ hasText: "Seat Sync" });
    await expect(seatSyncCard).toBeVisible();
    await expect(seatSyncCard.getByText("No runs recorded yet")).toBeVisible();
  });

  test("shows correct seat sync job execution data when seeded", async ({ page }) => {
    await seedJobExecution(
      "seat_sync",
      "success",
      "2026-02-27T10:00:00Z",
      "2026-02-27T10:01:00Z",
      null,
      50
    );

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const seatSyncCard = page
      .getByRole("article")
      .filter({ hasText: "Seat Sync" });
    await expect(seatSyncCard).toBeVisible();
    await expect(seatSyncCard.getByText("Success")).toBeVisible();
    await expect(seatSyncCard.getByText("50")).toBeVisible();
  });

  test("seat sync action is visible", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(
      page.getByRole("button", { name: /trigger seat sync/i })
    ).toBeVisible();
  });

  test("job status error does not block the seat list table", async ({
    page,
  }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      status: "active",
      firstName: "Octo",
      lastName: "Cat",
    });

    await loginViaApi(page, "admin", "password123");

    // Intercept the job-status API to force a failure
    await page.route("**/api/job-status", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" })
    );

    await page.goto("/management?tab=seats");

    // The inline error should be visible
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/failed to load seat sync status \(500\)/i)).toBeVisible();

    // The seat list table should still render normally
    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("octocat")).toBeVisible();
  });
});
