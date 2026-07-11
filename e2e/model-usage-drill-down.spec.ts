import { test, expect } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const currentMonthName = MONTH_NAMES[currentMonth - 1];

const TEST_DAY = 15;

async function seedConfiguration() {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey") VALUES ($1, $2, 'GLOBAL')
     ON CONFLICT ("singletonKey") DO NOTHING`,
    ["organisation", "TestOrg"],
  );
  await client.end();
}

async function seedDashboardSummary(
  month: number,
  year: number,
  modelUsage: unknown[] = [{ model: "GPT-4o", totalRequests: 130, totalAmount: 5.2 }],
) {
  const client = await getClient();
  await client.query(
    `INSERT INTO dashboard_monthly_summary ("month", "year", "totalSeats", "activeSeats", "totalSpending", "seatBaseCost", "totalAiCredits", "modelUsage", "mostActiveUsers", "leastActiveUsers")
     VALUES ($1, $2, 10, 8, 500, 300, 1000, $3::jsonb, '[]'::jsonb, '[]'::jsonb)
     ON CONFLICT ON CONSTRAINT "UQ_dashboard_monthly_summary_month_year" DO UPDATE SET
       "modelUsage" = EXCLUDED."modelUsage"`,
    [month, year, JSON.stringify(modelUsage)],
  );
  await client.end();
}

interface SeedSeatOptions {
  githubUsername: string;
  githubUserId: number;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  status?: string;
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
    ],
  );
  await client.end();
  return result.rows[0].id;
}

function makeUsageItem(
  model: string,
  grossQuantity: number,
  grossAmount: number,
) {
  return {
    product: "Copilot",
    sku: "Premium",
    model,
    unitType: "requests",
    pricePerUnit: 0.04,
    grossQuantity,
    grossAmount,
    discountQuantity: 0,
    discountAmount: 0,
    netQuantity: 0,
    netAmount: 0,
  };
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
    [seatId, day, month, year, JSON.stringify(usageItems)],
  );
  await client.end();
}

/**
 * Seed two users with usage on TEST_DAY for the current month:
 * - user-model-alpha: GPT-4o, 100 requests, $4.00
 * - user-model-beta: GPT-4o, 30 requests, $1.20 + Claude Sonnet 4.5, 50 requests, $2.00
 *
 * GPT-4o totals: 130 requests, $5.20, 2 active users
 * Claude Sonnet 4.5 totals: 50 requests, $2.00, 1 active user
 */
async function seedTestUsageData() {
  const seatAlpha = await seedSeat({
    githubUsername: "user-model-alpha",
    githubUserId: 2001,
    firstName: "Alice",
    lastName: "ModelAlpha",
    department: "Engineering",
  });

  const seatBeta = await seedSeat({
    githubUsername: "user-model-beta",
    githubUserId: 2002,
    firstName: "Bob",
    lastName: "ModelBeta",
    department: "Marketing",
  });

  await seedUsage(seatAlpha, TEST_DAY, currentMonth, currentYear, [
    makeUsageItem("GPT-4o", 100, 4.0),
  ]);

  await seedUsage(seatBeta, TEST_DAY, currentMonth, currentYear, [
    makeUsageItem("GPT-4o", 30, 1.2),
    makeUsageItem("Claude Sonnet 4.5", 50, 2.0),
  ]);
}

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM team_member_snapshot");
  await client.query("DELETE FROM team");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM department");
  await client.query("DELETE FROM dashboard_monthly_summary");
  await client.query("DELETE FROM job_execution");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Model Usage Drill-Down", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("should navigate to model detail page when clicking a model row on the dashboard", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear, [
      { model: "GPT-4o", totalRequests: 130, totalAmount: 5.2 },
    ]);
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    // Wait for AIC model breakdown table
    await expect(
      page.getByRole("heading", { name: "AIC Model Breakdown" }),
    ).toBeVisible();

    // Click the GPT-4o model row
    const modelTable = page
      .getByRole("heading", { name: "AIC Model Breakdown" })
      .locator("../../..")
      .locator("table");
    const gptRow = modelTable.locator("tbody tr", { hasText: "GPT-4o" });
    await gptRow.click();

    // Verify navigation to model detail page with monthly scope
    await expect(page).toHaveURL(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}`,
    );
  });

  test("should navigate to model detail page when clicking a model row on the daily detail page", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );

    // Wait for Model Breakdown table
    await expect(
      page.getByRole("heading", { name: "Model Breakdown" }),
    ).toBeVisible();

    // Click the GPT-4o model row
    const modelTable = page
      .getByRole("heading", { name: "Model Breakdown" })
      .locator("../../..")
      .locator("table");
    const gptRow = modelTable.locator("tbody tr", { hasText: "GPT-4o" });
    await gptRow.click();

    // Verify navigation to model detail page with daily scope
    await expect(page).toHaveURL(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}&day=${TEST_DAY}`,
    );
  });

  test("should display correct heading with model name and monthly scope", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — GPT-4o — ${currentMonthName} ${currentYear}`,
      }),
    ).toBeVisible();
  });

  test("should display correct heading with model name and daily scope", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}&day=${TEST_DAY}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — GPT-4o — ${currentMonthName} ${TEST_DAY}, ${currentYear}`,
      }),
    ).toBeVisible();
  });

  test("should display summary cards with correct totals", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}`,
    );

    // Wait for heading to confirm data loaded
    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — GPT-4o — ${currentMonthName} ${currentYear}`,
      }),
    ).toBeVisible();

    // Total Requests: 130 (100 + 30)
    await expect(page.getByText("130")).toBeVisible();
    // Total Spending: $5.20
    await expect(page.getByText("$5.20")).toBeVisible();
    // Active Users: 2
    const activeUsersCard = page.getByText("Active Users").locator("..");
    await expect(activeUsersCard.getByText("2")).toBeVisible();
  });

  test("should display users table with correct data", async ({ page }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}`,
    );

    // Users table section
    await expect(
      page.getByRole("heading", { name: "Users", exact: true }),
    ).toBeVisible();

    const usersTable = page
      .getByRole("heading", { name: "Users", exact: true })
      .locator("../../..")
      .locator("table");

    // Verify user-model-alpha row (100 requests, $4.00)
    const alphaRow = usersTable.locator("tbody tr", {
      hasText: "user-model-alpha",
    });
    await expect(alphaRow).toBeVisible();
    await expect(alphaRow.getByText("Alice ModelAlpha")).toBeVisible();
    await expect(alphaRow.getByText("Engineering")).toBeVisible();
    await expect(alphaRow.getByText("100")).toBeVisible();
    await expect(alphaRow.getByText("$4.00")).toBeVisible();

    // Verify user-model-beta row (30 requests, $1.20 — only GPT-4o usage)
    const betaRow = usersTable.locator("tbody tr", {
      hasText: "user-model-beta",
    });
    await expect(betaRow).toBeVisible();
    await expect(betaRow.getByText("Bob ModelBeta")).toBeVisible();
    await expect(betaRow.getByText("Marketing")).toBeVisible();
    await expect(betaRow.getByText("30")).toBeVisible();
    await expect(betaRow.getByText("$1.20")).toBeVisible();
  });

  test("should sort users table when clicking column header", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "Users", exact: true }),
    ).toBeVisible();

    const usersTable = page
      .getByRole("heading", { name: "Users", exact: true })
      .locator("../../..")
      .locator("table");

    // Default sort is totalRequests desc — user-model-alpha (100) should be first
    const firstRowDefault = usersTable.locator("tbody tr").first();
    await expect(firstRowDefault.getByText("user-model-alpha")).toBeVisible();

    // Click Requests column to toggle to asc — user-model-beta (30) should be first
    await page
      .getByRole("button", { name: /sort by aic units/i })
      .click();
    const firstRowAsc = usersTable.locator("tbody tr").first();
    await expect(firstRowAsc.getByText("user-model-beta")).toBeVisible();

    // Click Spending column to sort by spending desc — user-model-alpha ($4.00) should be first
    await page
      .getByRole("button", { name: /sort by aic cost/i })
      .click();
    const firstRowSpending = usersTable.locator("tbody tr").first();
    await expect(
      firstRowSpending.getByText("user-model-alpha"),
    ).toBeVisible();
  });

  test("should navigate back to dashboard when clicking back link from monthly scope", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — GPT-4o — ${currentMonthName} ${currentYear}`,
      }),
    ).toBeVisible();

    await page.getByRole("link", { name: /back to dashboard/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("should navigate back to daily detail page when clicking back link from daily scope", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/GPT-4o?month=${currentMonth}&year=${currentYear}&day=${TEST_DAY}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — GPT-4o — ${currentMonthName} ${TEST_DAY}, ${currentYear}`,
      }),
    ).toBeVisible();

    await page.getByRole("link", { name: /back to daily aic usage/i }).click();

    await expect(page).toHaveURL(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );
  });

  test("should display empty state message when no usage data exists for the model", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/NonExistentModel?month=1&year=2020`,
    );

    await expect(
      page.getByRole("heading", {
        name: "AIC Model Usage — NonExistentModel — January 2020",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("No AIC CSV data for this model and time period."),
    ).toBeVisible();
  });

  test("should handle model name with special characters in URL", async ({
    page,
  }) => {
    // Seed a seat and usage with a special-char model name
    const seatId = await seedSeat({
      githubUsername: "user-model-special",
      githubUserId: 2003,
      firstName: "Charlie",
      lastName: "Special",
      department: "Research",
    });

    await seedUsage(seatId, TEST_DAY, currentMonth, currentYear, [
      makeUsageItem("GPT-4o/Mini Plus", 25, 1.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/${encodeURIComponent("GPT-4o/Mini Plus")}?month=${currentMonth}&year=${currentYear}`,
    );

    // Verify the heading shows the decoded model name
    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — GPT-4o/Mini Plus — ${currentMonthName} ${currentYear}`,
      }),
    ).toBeVisible();

    // Verify data is displayed — use the table row to avoid ambiguity
    const usersTable = page
      .getByRole("heading", { name: "Users", exact: true })
      .locator("../../..")
      .locator("table");
    const specialRow = usersTable.locator("tbody tr", {
      hasText: "user-model-special",
    });
    await expect(specialRow).toBeVisible();
    await expect(specialRow.getByText("25")).toBeVisible();
    await expect(specialRow.getByText("$1.00")).toBeVisible();
  });

  test("should navigate from model users seat link to seat model daily detail with scope preserved", async ({
    page,
  }) => {
    const specialModel = "Model Name / 50%";

    const seatId = await seedSeat({
      githubUsername: "seat-model-route-user",
      githubUserId: 2004,
      firstName: "Dana",
      lastName: "Scoped",
      department: "Operations",
    });

    await seedUsage(seatId, TEST_DAY, currentMonth, currentYear, [
      makeUsageItem(specialModel, 25, 1.0),
      makeUsageItem("Another Model", 60, 2.4),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/model/${encodeURIComponent(specialModel)}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `AIC Model Usage — ${specialModel} — ${currentMonthName} ${currentYear}`,
      }),
    ).toBeVisible();

    const seatLink = page.getByRole("link", { name: "seat-model-route-user" });
    await expect(seatLink).toBeVisible();
    await seatLink.click();

    await expect(page).toHaveURL(
      `/usage/seats/${seatId}/models/${encodeURIComponent(specialModel)}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `Daily AIC Units for ${specialModel} by seat-model-route-user (${currentMonthName} ${currentYear})`,
      }),
    ).toBeVisible();
  });
});
