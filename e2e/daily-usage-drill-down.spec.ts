import { test, expect } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

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

async function seedDashboardSummary(month: number, year: number) {
  const client = await getClient();
  await client.query(
    `INSERT INTO dashboard_monthly_summary ("month", "year", "totalSeats", "activeSeats", "totalSpending", "seatBaseCost", "totalAiCredits", "modelUsage", "mostActiveUsers", "leastActiveUsers")
     VALUES ($1, $2, 10, 8, 500, 300, 1000, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
     ON CONFLICT ON CONSTRAINT "UQ_dashboard_monthly_summary_month_year" DO NOTHING`,
    [month, year],
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
 * - user-alpha: GPT-4o, 100 requests, $4.00
 * - user-beta: Claude Sonnet 4.5, 50 requests, $2.00 + GPT-4o, 30 requests, $1.20
 *
 * Totals:
 *   Per-user: alpha=100 reqs/$4.00, beta=80 reqs/$3.20
 *   Per-model: GPT-4o=130 reqs/$5.20, Claude Sonnet 4.5=50 reqs/$2.00
 *   Summary: 180 requests, $7.20 spending, 2 active users, 2 models
 */
async function seedTestUsageData() {
  const seatAlpha = await seedSeat({
    githubUsername: "user-alpha",
    githubUserId: 1001,
    firstName: "Alice",
    lastName: "Alpha",
    department: "Engineering",
  });

  const seatBeta = await seedSeat({
    githubUsername: "user-beta",
    githubUserId: 1002,
    firstName: "Bob",
    lastName: "Beta",
    department: "Marketing",
  });

  await seedUsage(seatAlpha, TEST_DAY, currentMonth, currentYear, [
    makeUsageItem("GPT-4o", 100, 4.0),
  ]);

  await seedUsage(seatBeta, TEST_DAY, currentMonth, currentYear, [
    makeUsageItem("Claude Sonnet 4.5", 50, 2.0),
    makeUsageItem("GPT-4o", 30, 1.2),
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

test.describe("Daily Usage Drill-Down", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("should navigate to detail page when clicking a chart bar", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    // Wait for the daily chart section to appear
    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();

    // Wait for Recharts chart to render with bars
    const chartSection = page.getByRole("heading", { name: /daily aic units/i }).locator("../..");
    await expect(chartSection).toBeVisible();

    // Recharts 3 renders bars as SVG <path> elements with class "recharts-rectangle"
    // The SVG element isn't actionable via standard click, so dispatch event directly
    await page.locator("path[fill='#2563eb']").first().dispatchEvent("click");

    // Verify navigation to daily detail page
    await page.waitForURL(/\/dashboard\/daily\/\d+\?month=\d+&year=\d+/);
    await expect(page).toHaveURL(
      /\/dashboard\/daily\/\d+\?month=\d+&year=\d+/,
    );
  });

  test("should display the correct date in the header", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/15?month=3&year=2026`,
    );

    await expect(
      page.getByRole("heading", { name: "Daily AIC Units — March 15, 2026" }),
    ).toBeVisible();
  });

  test("should display summary cards with correct totals", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );

    // Wait for data to load
    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();

    // Total AIC Units: 180 (100 + 80)
    await expect(page.getByText("180")).toBeVisible();
    // Total Spending: $7.20
    await expect(page.getByText("$7.20")).toBeVisible();
    // Active Users: 2
    const activeUsersCard = page
      .getByText("Active Users")
      .locator("..");
    await expect(activeUsersCard.getByText("2")).toBeVisible();
    // Models Used: 2
    const modelsUsedCard = page
      .getByText("Models Used")
      .locator("..");
    await expect(modelsUsedCard.getByText("2")).toBeVisible();
  });

  test("should display users table with correct data", async ({ page }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );

    // Users table section
    await expect(
      page.getByRole("heading", { name: "Users", exact: true }),
    ).toBeVisible();

    // Verify column headers
    const usersTable = page
      .getByRole("heading", { name: "Users", exact: true })
      .locator("../../..")
      .locator("table");

    await expect(
      usersTable.getByRole("button", { name: /sort by github username/i }),
    ).toBeVisible();
    await expect(
      usersTable.getByRole("columnheader", { name: /display name/i }),
    ).toBeVisible();
    await expect(
      usersTable.getByRole("columnheader", { name: /department/i }),
    ).toBeVisible();
    await expect(
      usersTable.getByRole("button", { name: /sort by aic units/i }),
    ).toBeVisible();
    await expect(
      usersTable.getByRole("button", { name: /sort by aic cost/i }),
    ).toBeVisible();

    // Verify user-alpha row
    const alphaRow = usersTable.locator("tbody tr", {
      hasText: "user-alpha",
    });
    await expect(alphaRow).toBeVisible();
    await expect(alphaRow.getByText("Alice Alpha")).toBeVisible();
    await expect(alphaRow.getByText("Engineering")).toBeVisible();
    await expect(alphaRow.getByText("100")).toBeVisible();
    await expect(alphaRow.getByText("$4.00")).toBeVisible();

    // Verify user-beta row
    const betaRow = usersTable.locator("tbody tr", {
      hasText: "user-beta",
    });
    await expect(betaRow).toBeVisible();
    await expect(betaRow.getByText("Bob Beta")).toBeVisible();
    await expect(betaRow.getByText("Marketing")).toBeVisible();
    await expect(betaRow.getByText("80")).toBeVisible();
    await expect(betaRow.getByText("$3.20")).toBeVisible();
  });

  test("should sort users table when clicking column header", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "Users", exact: true }),
    ).toBeVisible();

    const usersTable = page
      .getByRole("heading", { name: "Users", exact: true })
      .locator("../../..")
      .locator("table");

    // Default sort is totalRequests desc — user-alpha (100) should be first
    const firstRowDefault = usersTable.locator("tbody tr").first();
    await expect(firstRowDefault.getByText("user-alpha")).toBeVisible();

    // Click Requests column to toggle to asc — user-beta (80) should be first
    await page
      .getByRole("button", { name: /sort by aic units/i })
      .click();
    const firstRowAsc = usersTable.locator("tbody tr").first();
    await expect(firstRowAsc.getByText("user-beta")).toBeVisible();

    // Click GitHub Username to sort by username desc — user-beta > user-alpha alphabetically
    await page
      .getByRole("button", { name: /sort by github username/i })
      .click();
    const firstRowUsername = usersTable.locator("tbody tr").first();
    await expect(firstRowUsername.getByText("user-beta")).toBeVisible();
  });

  test("should display model breakdown with correct data", async ({
    page,
  }) => {
    await seedTestUsageData();

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );

    // Model Breakdown table section
    await expect(
      page.getByRole("heading", { name: "Model Breakdown" }),
    ).toBeVisible();

    const modelTable = page
      .getByRole("heading", { name: "Model Breakdown" })
      .locator("../../..")
      .locator("table");

    // GPT-4o: 130 requests, $5.20
    const gptRow = modelTable.locator("tbody tr", { hasText: "GPT-4o" });
    await expect(gptRow).toBeVisible();
    await expect(gptRow.getByText("130")).toBeVisible();
    await expect(gptRow.getByText("$5.20")).toBeVisible();

    // Claude Sonnet 4.5: 50 requests, $2.00
    const claudeRow = modelTable.locator("tbody tr", {
      hasText: "Claude Sonnet 4.5",
    });
    await expect(claudeRow).toBeVisible();
    await expect(claudeRow.getByText("50")).toBeVisible();
    await expect(claudeRow.getByText("$2.00")).toBeVisible();
  });

  test("should navigate back to dashboard when clicking back link", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/dashboard/daily/${TEST_DAY}?month=${currentMonth}&year=${currentYear}`,
    );

    // Wait for page to load (even empty state)
    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();

    await page.getByRole("link", { name: /back to dashboard/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("should display empty state when no usage data exists for the day", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard/daily/28?month=1&year=2020");

    await expect(
      page.getByRole("heading", {
        name: "Daily AIC Units — January 28, 2020",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("No AIC CSV data for this day yet."),
    ).toBeVisible();
  });
});
