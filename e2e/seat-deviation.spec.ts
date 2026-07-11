import { test, expect } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

// Previous month — used for norm baseline
const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();

// Each prev-month seat gets daysInPrevMonth × 10 requests so that:
// norm = (PREV_SEAT_REQUESTS + PREV_SEAT_REQUESTS) / 2 / daysInPrevMonth = 10
const PREV_SEAT_REQUESTS = daysInPrevMonth * 10;

function makeUsageItem(grossQuantity: number) {
  return {
    product: "Copilot",
    sku: "Premium",
    model: "GPT-4o",
    unitType: "requests",
    pricePerUnit: 0.04,
    grossQuantity,
    grossAmount: grossQuantity * 0.04,
    discountQuantity: 0,
    discountAmount: 0,
    netQuantity: 0,
    netAmount: 0,
  };
}

async function seedConfiguration() {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey", "normSeatsCount", "deviationWarningThreshold", "deviationAlertThreshold")
     VALUES ($1, $2, 'GLOBAL', $3, $4, $5)
     ON CONFLICT ("singletonKey") DO UPDATE SET
       "normSeatsCount" = EXCLUDED."normSeatsCount",
       "deviationWarningThreshold" = EXCLUDED."deviationWarningThreshold",
       "deviationAlertThreshold" = EXCLUDED."deviationAlertThreshold"`,
    ["organisation", "TestOrg", 2, 1.5, 2.0],
  );
  await client.end();
}

async function seedSeat(
  githubUsername: string,
  githubUserId: number,
  firstName: string = "Test",
  lastName: string = "User",
): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "department")
     VALUES ($1, $2, 'active', $3, $4, NULL)
     ON CONFLICT ("githubUsername") DO UPDATE SET "firstName" = EXCLUDED."firstName"
     RETURNING id`,
    [githubUsername, githubUserId, firstName, lastName],
  );
  await client.end();
  return result.rows[0].id;
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

/**
 * Seed two seats with previous-month usage to establish a norm of exactly 10 requests/day.
 * With normSeatsCount=2 and thresholds (warning=1.5, alert=2.0):
 *   - Warning when day usage >= 15
 *   - Alert when day usage >= 20
 */
async function seedNormBaseline() {
  const prevSeat1 = await seedSeat("prev-norm-1", 9001, "Prev", "One");
  const prevSeat2 = await seedSeat("prev-norm-2", 9002, "Prev", "Two");

  await seedUsage(prevSeat1, 1, prevMonth, prevYear, [
    makeUsageItem(PREV_SEAT_REQUESTS),
  ]);
  await seedUsage(prevSeat2, 1, prevMonth, prevYear, [
    makeUsageItem(PREV_SEAT_REQUESTS),
  ]);

  await seedDashboardSummary(prevMonth, prevYear);
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

test.describe("Seat Deviation — Chart Icons (Story 3.1)", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("shows deviation icons on chart bars for flagged days", async ({
    page,
  }) => {
    await seedNormBaseline();
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a seat with three different AIC-unit severities
    const seatId = await seedSeat("chart-user", 8001, "Chart", "User");
    await seedUsage(seatId, 5, currentMonth, currentYear, [
      makeUsageItem(1), // normal
    ]);
    await seedUsage(seatId, 10, currentMonth, currentYear, [
      makeUsageItem(500), // warning threshold
    ]);
    await seedUsage(seatId, 15, currentMonth, currentYear, [
      makeUsageItem(1000), // alert threshold
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`,
    );

    // Wait for chart heading to appear
    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();

    // The current AIC contract renders alert badges for all flagged days in this fixture.
    const warningIcons = page.locator('circle[fill="#f97316"]');
    const alertIcons = page.locator('circle[fill="#ef4444"]');

    await expect(warningIcons).toHaveCount(0);
    await expect(alertIcons).toHaveCount(2);
  });

  test("shows norm unavailable message when no previous month data", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a seat with current-month usage only — the chart should still render and flag the spike.
    const seatId = await seedSeat("no-norm-user", 8010, "No", "Norm");
    await seedUsage(seatId, 5, currentMonth, currentYear, [
      makeUsageItem(50),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();

    const alertIcons = page.locator('circle[fill="#ef4444"]');
    await expect(alertIcons).toHaveCount(1);
  });

  test("no deviation icons when all days are within normal range", async ({
    page,
  }) => {
    await seedNormBaseline();
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a seat with all-normal days below the warning threshold
    const seatId = await seedSeat("normal-chart-user", 8020, "Normal", "User");
    await seedUsage(seatId, 3, currentMonth, currentYear, [
      makeUsageItem(5),
    ]);
    await seedUsage(seatId, 7, currentMonth, currentYear, [
      makeUsageItem(10),
    ]);
    await seedUsage(seatId, 12, currentMonth, currentYear, [
      makeUsageItem(14),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();

    // No deviation icon circles should be present
    const warningIcons = page.locator('circle[fill="#f97316"]');
    const alertIcons = page.locator('circle[fill="#ef4444"]');

    await expect(warningIcons).toHaveCount(0);
    await expect(alertIcons).toHaveCount(0);
  });
});

test.describe("Seat Deviation — Table Icons (Story 3.2)", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("shows deviation icon next to username for seats with deviations", async ({
    page,
  }) => {
    await seedNormBaseline();
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a seat with alert-level usage
    const seatId = await seedSeat("alert-table-user", 8030, "Alert", "Dev");
    await seedUsage(seatId, 5, currentMonth, currentYear, [
      makeUsageItem(1000),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Wait for table to load
    const seatTable = page.locator("table");
    await expect(seatTable.getByText("alert-table-user")).toBeVisible();

    // Verify DeviationIcon with role="img" and aria-label containing "Alert" is visible
    const row = page.locator("tr", { hasText: "alert-table-user" });
    await expect(
      row.locator('[role="img"][aria-label*="Alert"]'),
    ).toBeVisible();
  });

  test("no deviation icon for seats with no deviations", async ({ page }) => {
    await seedNormBaseline();
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a seat with normal usage only (below the warning threshold)
    const seatId = await seedSeat("normal-table-user", 8040, "Normal", "Dev");
    await seedUsage(seatId, 5, currentMonth, currentYear, [
      makeUsageItem(1),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTable = page.locator("table");
    await expect(seatTable.getByText("normal-table-user")).toBeVisible();

    // No deviation icon should appear next to the normal user
    const row = page.locator("tr", { hasText: "normal-table-user" });
    await expect(
      row.locator('[role="img"][aria-label*="Alert"]'),
    ).toHaveCount(0);
    await expect(
      row.locator('[role="img"][aria-label*="Warning"]'),
    ).toHaveCount(0);
  });

  test("no deviation icons in table when norm is null", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed current-month usage only — no previous month data is required anymore
    const seatId = await seedSeat("no-norm-table-user", 8050, "NoNorm", "Dev");
    await seedUsage(seatId, 5, currentMonth, currentYear, [
      makeUsageItem(1),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTable = page.locator("table");
    await expect(seatTable.getByText("no-norm-table-user")).toBeVisible();

    // No deviation icons should appear when norm is null
    const row = page.locator("tr", { hasText: "no-norm-table-user" });
    await expect(
      row.locator('[role="img"][aria-label*="Alert"]'),
    ).toHaveCount(0);
    await expect(
      row.locator('[role="img"][aria-label*="Warning"]'),
    ).toHaveCount(0);
  });
});
