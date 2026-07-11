import { test, expect } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

async function seedConfiguration() {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey")
     VALUES ($1, $2, 'GLOBAL')
     ON CONFLICT ("singletonKey") DO UPDATE SET "apiMode" = EXCLUDED."apiMode", "entityName" = EXCLUDED."entityName"`,
    ["organisation", "TestOrg"]
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
}

async function seedSeat(options: SeedSeatOptions): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "department")
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("githubUsername") DO UPDATE SET "firstName" = EXCLUDED."firstName"
     RETURNING id`,
    [
      options.githubUsername,
      options.githubUserId,
      options.status ?? "active",
      options.firstName ?? null,
      options.lastName ?? null,
      options.department ?? null,
    ]
  );
  await client.end();
  return result.rows[0].id;
}

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM team_member_snapshot");
  await client.query("DELETE FROM team");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM department");
  await client.query("DELETE FROM job_execution");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Low Usage Seats Table", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("should display seat sync card on Seats tab", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(
      page.getByRole("heading", { name: "Seat Sync" })
    ).toBeVisible();
    await expect(page.getByText("No runs recorded yet")).toBeVisible();
  });

  test("should display seat list empty state when no seats exist", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(
      page.getByRole("heading", { name: "No seats synced" })
    ).toBeVisible();
    await expect(
      page.getByText(/No seats have been synced yet/i)
    ).toBeVisible();
  });

  test("should display a synced seat in the seat list", async ({ page }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      status: "active",
      firstName: "Octo",
      lastName: "Cat",
      department: "Engineering",
      lastActivityAt: "2024-06-15T12:00:00.000Z",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("octocat")).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "AIC Units" })).toBeVisible();
  });

  test("should display seat sync card and empty seat list when no seats exist", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(page.getByRole("heading", { name: "Seat Sync" })).toBeVisible();
    await expect(page.getByText("No runs recorded yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No seats synced" })).toBeVisible();
    await expect(page.getByText(/No seats have been synced yet/i)).toBeVisible();
  });

  test("should display the synced seat list with current management fields", async ({
    page,
  }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      status: "active",
      firstName: "Octo",
      lastName: "Cat",
      department: "Engineering",
      lastActivityAt: "2024-06-15T12:00:00.000Z",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("octocat")).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "AIC Units" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /Status/i })).toBeVisible();

    const seatRow = table.locator("tr", { hasText: "octocat" });
    await expect(seatRow.getByRole("button", { name: /Edit first name/i })).toHaveText("Octo");
    await expect(seatRow.getByRole("button", { name: /Edit department/i })).toHaveText("Engineering");
    await expect(seatRow.getByLabel("Status: Active")).toBeVisible();
  });
});
