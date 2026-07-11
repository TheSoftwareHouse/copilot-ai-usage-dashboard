import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

async function seedConfiguration() {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey") VALUES ($1, $2, 'GLOBAL')
     ON CONFLICT ("singletonKey") DO NOTHING`,
    ["organisation", "TestOrg"],
  );
  await client.end();
}

async function seedDashboardSummary() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();

  const modelUsage = JSON.stringify([
    { model: "GPT-4o", totalRequests: 150, totalAmount: 450.0 },
    { model: "Claude Sonnet 4.5", totalRequests: 80, totalAmount: 320.0 },
  ]);

  const mostActiveUsers = JSON.stringify([
    { seatId: 101, githubUsername: "top-user-1", firstName: "Alice", lastName: "Smith", totalRequests: 500, totalSpending: 125.50 },
    { seatId: 102, githubUsername: "top-user-2", firstName: "Bob", lastName: "Jones", totalRequests: 350, totalSpending: 87.25 },
  ]);

  const leastActiveUsers = JSON.stringify([
    { seatId: 201, githubUsername: "low-user-1", firstName: "Charlie", lastName: "Brown", totalRequests: 10, totalSpending: 2.50 },
    { seatId: 202, githubUsername: "low-user-2", firstName: null, lastName: null, totalRequests: 25, totalSpending: 6.25 },
  ]);

  const client = await getClient();
  await client.query(
    `INSERT INTO dashboard_monthly_summary ("month", "year", "totalSeats", "activeSeats", "totalSpending", "seatBaseCost", "totalAiCredits", "modelUsage", "mostActiveUsers", "leastActiveUsers")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
     ON CONFLICT ON CONSTRAINT "UQ_dashboard_monthly_summary_month_year" DO UPDATE SET
       "totalSeats" = EXCLUDED."totalSeats",
       "activeSeats" = EXCLUDED."activeSeats",
       "totalSpending" = EXCLUDED."totalSpending",
       "seatBaseCost" = EXCLUDED."seatBaseCost",
       "totalAiCredits" = EXCLUDED."totalAiCredits",
       "modelUsage" = EXCLUDED."modelUsage",
       "mostActiveUsers" = EXCLUDED."mostActiveUsers",
       "leastActiveUsers" = EXCLUDED."leastActiveUsers",
       "updatedAt" = now()`,
    [month, year, 42, 38, 770.0, 722.0, 15000, modelUsage, mostActiveUsers, leastActiveUsers],
  );
  await client.end();
}

async function seedSummaryForMonth(
  month: number,
  year: number,
  overrides: {
    totalSeats?: number;
    activeSeats?: number;
    totalSpending?: number;
    seatBaseCost?: number;
    totalAiCredits?: number;
    modelUsage?: unknown[];
    mostActiveUsers?: unknown[];
    leastActiveUsers?: unknown[];
  } = {},
) {
  const {
    totalSeats = 10,
    activeSeats = 8,
    totalSpending = 500.0,
    seatBaseCost = 152.0,
    totalAiCredits = 1200,
    modelUsage = [{ model: "GPT-4o", totalRequests: 50, totalAmount: 200.0 }],
    mostActiveUsers = [{ seatId: 1, githubUsername: "user-1", firstName: "Test", lastName: "User", totalRequests: 100, totalSpending: 50.0 }],
    leastActiveUsers = [{ seatId: 2, githubUsername: "user-2", firstName: "Low", lastName: "User", totalRequests: 5, totalSpending: 2.0 }],
  } = overrides;

  const client = await getClient();
  await client.query(
    `INSERT INTO dashboard_monthly_summary ("month", "year", "totalSeats", "activeSeats", "totalSpending", "seatBaseCost", "totalAiCredits", "modelUsage", "mostActiveUsers", "leastActiveUsers")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
     ON CONFLICT ON CONSTRAINT "UQ_dashboard_monthly_summary_month_year" DO UPDATE SET
       "totalSeats" = EXCLUDED."totalSeats",
       "activeSeats" = EXCLUDED."activeSeats",
       "totalSpending" = EXCLUDED."totalSpending",
       "seatBaseCost" = EXCLUDED."seatBaseCost",
       "totalAiCredits" = EXCLUDED."totalAiCredits",
       "modelUsage" = EXCLUDED."modelUsage",
       "mostActiveUsers" = EXCLUDED."mostActiveUsers",
       "leastActiveUsers" = EXCLUDED."leastActiveUsers",
       "updatedAt" = now()`,
    [
      month, year, totalSeats, activeSeats, totalSpending, seatBaseCost,
      totalAiCredits,
      JSON.stringify(modelUsage), JSON.stringify(mostActiveUsers), JSON.stringify(leastActiveUsers),
    ],
  );
  await client.end();
}

async function seedCopilotSeat(
  overrides: {
    githubUsername?: string;
    githubUserId?: number;
    status?: string;
  } = {},
): Promise<number> {
  const {
    githubUsername = `dashboard-seat-${Date.now()}`,
    githubUserId = Math.floor(Math.random() * 1_000_000),
    status = "active",
  } = overrides;
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status")
     VALUES ($1, $2, $3)
     RETURNING id`,
    [githubUsername, githubUserId, status],
  );
  await client.end();
  return result.rows[0].id;
}

async function seedCopilotUsage(
  overrides: {
    seatId: number;
    day?: number;
    month?: number;
    year?: number;
    usageItems?: unknown[];
  },
): Promise<void> {
  const now = new Date();
  const {
    seatId,
    day = 1,
    month = now.getUTCMonth() + 1,
    year = now.getUTCFullYear(),
    usageItems = [
      {
        product: "Copilot",
        sku: "Premium",
        model: "GPT-4o",
        unitType: "requests",
        pricePerUnit: 0.04,
        grossQuantity: 50,
        grossAmount: 2.0,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 50,
        netAmount: 2.0,
      },
    ],
  } = overrides;
  const client = await getClient();
  await client.query(
    `INSERT INTO copilot_usage ("seatId", "day", "month", "year", "usageItems")
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [seatId, day, month, year, JSON.stringify(usageItems)],
  );
  await client.end();
}

function makeCostUsageItem(grossQuantity: number) {
  return {
    product: "Copilot",
    sku: "AIC",
    model: "GPT-4o",
    unitType: "requests",
    pricePerUnit: 0.01,
    grossQuantity,
    grossAmount: grossQuantity * 0.01,
    discountQuantity: 0,
    discountAmount: 0,
    netQuantity: 0,
    netAmount: 0,
  };
}

function expectedElapsedDays(month: number, year: number, calendarDays: number): number {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return calendarDays;
  }

  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return 0;
  }

  return Math.min(now.getUTCDate(), calendarDays);
}

function expectedCostCards(totalGrossQuantity: number, month: number, year: number) {
  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const elapsedDays = expectedElapsedDays(month, year, calendarDays);
  let workingDays = 0;

  for (let day = 1; day <= calendarDays; day++) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday >= 1 && weekday <= 5) workingDays++;
  }

  const totalCost = totalGrossQuantity / 100;
  const averageDailyCost = elapsedDays > 0 ? Math.round((totalCost / elapsedDays) * 100) / 100 : 0;
  const predictedMonthCost = averageDailyCost * workingDays;

  return {
    averageDailyCost: `$${averageDailyCost.toFixed(2)}`,
    totalCost: `$${totalCost.toFixed(2)}`,
    predictedMonthCost: `$${predictedMonthCost.toFixed(2)}`,
  };
}

async function expectCostCards(
  page: Page,
  values: ReturnType<typeof expectedCostCards>,
) {
  for (const [label, value] of [
    ["Average Daily Cost", values.averageDailyCost],
    ["Total Cost", values.totalCost],
    ["Predicted Month Cost", values.predictedMonthCost],
  ] as const) {
    const card = page.getByRole("heading", { name: label }).locator("..");
    await expect(card).toBeVisible();
    await expect(card.getByText(value, { exact: true })).toBeVisible();
  }
}

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM dashboard_monthly_summary");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Dashboard", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("dashboard is the landing page — navigating to / redirects to /dashboard", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: /monthly usage overview/i }),
    ).toBeVisible();
  });

  test("dashboard displays per-model usage", async ({ page }) => {
    await seedDashboardSummary();
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expect(page.getByText("GPT-4o")).toBeVisible();
    await expect(page.getByText("Claude Sonnet 4.5")).toBeVisible();
    await expect(page.getByText("$450.00")).toBeVisible();
    await expect(page.getByText("$320.00")).toBeVisible();
  });

  test("dashboard displays most active users", async ({ page }) => {
    await seedDashboardSummary();
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: /most active users/i }),
    ).toBeVisible();
    await expect(page.getByText("top-user-1")).toBeVisible();
    await expect(page.getByText("Alice Smith")).toBeVisible();
    await expect(page.getByText("$125.50")).toBeVisible();
    await expect(page.getByText("top-user-2")).toBeVisible();
    await expect(page.getByText("$87.25")).toBeVisible();

    const mostActiveHeading = page.getByRole("heading", { name: /most active users/i });
    const mostActiveCard = mostActiveHeading.locator("../..");
    await expect(mostActiveCard.getByText("500 AIC Units", { exact: true })).toBeVisible();
  });

  test("most active user rows stay linked to seat detail", async ({ page }) => {
    await seedDashboardSummary();
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const mostActiveHeading = page.getByRole("heading", { name: /most active users/i });
    const mostActiveCard = mostActiveHeading.locator("../..");
    const firstUserLink = mostActiveCard.getByRole("link", { name: /top-user-1/i });
    await expect(firstUserLink).toBeVisible();
    await expect(firstUserLink).toHaveAttribute("href", /\/usage\/seats\/101\?month=\d+&year=\d+/);
  });

  test("dashboard displays empty state when no summary data exists", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expectCostCards(page, {
      averageDailyCost: "$0.00",
      totalCost: "$0.00",
      predictedMonthCost: "$0.00",
    });
    await expect(
      page.getByText(/no aic csv data has been imported/i),
    ).toBeVisible();
  });

  test("dashboard cost cards recalculate for the selected month", async ({ page }) => {
    const currentMonth = new Date().getUTCMonth() + 1;
    const currentYear = new Date().getUTCFullYear();
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedSummaryForMonth(currentMonth, currentYear);
    await seedSummaryForMonth(previousMonth, previousYear);

    const seatId = await seedCopilotSeat({ githubUsername: "cost-dashboard-user" });
    await seedCopilotUsage({
      seatId,
      day: 1,
      month: currentMonth,
      year: currentYear,
      usageItems: [makeCostUsageItem(1000)],
    });
    await seedCopilotUsage({
      seatId,
      day: 2,
      month: currentMonth,
      year: currentYear,
      usageItems: [makeCostUsageItem(2100)],
    });
    await seedCopilotUsage({
      seatId,
      day: 1,
      month: previousMonth,
      year: previousYear,
      usageItems: [makeCostUsageItem(3000)],
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expectCostCards(page, expectedCostCards(3100, currentMonth, currentYear));

    const select = page.getByLabel("Month", { exact: true });
    await select.selectOption(`${previousMonth}-${previousYear}`);
    await expectCostCards(page, expectedCostCards(3000, previousMonth, previousYear));
  });

  test("dashboard cost cards remain visible in an AIC reporting month", async ({ page }) => {
    const aicMonth = 5;
    const aicYear = 2026;

    await seedSummaryForMonth(aicMonth, aicYear);
    const seatId = await seedCopilotSeat({ githubUsername: "aic-dashboard-user" });
    await seedCopilotUsage({
      seatId,
      day: 1,
      month: aicMonth,
      year: aicYear,
      usageItems: [makeCostUsageItem(400)],
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const select = page.getByLabel("Month", { exact: true });
    await select.selectOption(`${aicMonth}-${aicYear}`);

    await expect(page.getByRole("heading", { name: "Daily AIC Units" })).toBeVisible();
    await expectCostCards(page, expectedCostCards(400, aicMonth, aicYear));
  });

  test("shows daily aic units chart when usage data exists", async ({ page }) => {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    await seedDashboardSummary();
    const seatId = await seedCopilotSeat({ githubUsername: "chart-user" });
    await seedCopilotUsage({ seatId, day: 1, month, year });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeVisible();
  });

  test("hides daily aic units chart when no usage data exists", async ({ page }) => {
    await seedDashboardSummary();

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: /daily aic units/i }),
    ).toBeHidden();
  });

  test("should show chart legend with current and previous month names when previous month usage data exists", async ({ page }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedDashboardSummary();
    const seatId = await seedCopilotSeat({ githubUsername: "legend-user" });
    await seedCopilotUsage({ seatId, day: 1, month: currentMonth, year: currentYear });
    await seedCopilotUsage({ seatId, day: 1, month: prevMonth, year: prevYear });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const currentMonthLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
    const previousMonthLabel = `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`;

    const chart = page.getByRole("img", { name: /daily aic units bar chart/i });
    await expect(chart).toBeVisible();
    await expect(chart.getByText(currentMonthLabel)).toBeVisible();
    await expect(chart.getByText(previousMonthLabel)).toBeVisible();
  });

  test("should not show chart legend when no previous month usage data exists", async ({ page }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedDashboardSummary();
    const seatId = await seedCopilotSeat({ githubUsername: "no-legend-user" });
    await seedCopilotUsage({ seatId, day: 1, month: currentMonth, year: currentYear });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const currentMonthLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
    const previousMonthLabel = `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`;

    const chart = page.getByRole("img", { name: /daily aic units bar chart/i });
    await expect(chart).toBeVisible();
    await expect(chart.getByText(currentMonthLabel)).toBeHidden();
    await expect(chart.getByText(previousMonthLabel)).toBeHidden();
  });
});

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

test.describe("Dashboard — Month Filter", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("month filter dropdown is visible on the dashboard", async ({ page }) => {
    await seedDashboardSummary();
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expect(page.getByLabel("Month", { exact: true })).toBeVisible();
  });

  test("current month is selected by default", async ({ page }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();
    const expectedLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

    await seedDashboardSummary();
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const select = page.getByLabel("Month", { exact: true });
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(`${currentMonth}-${currentYear}`);
    // Verify the displayed text matches the expected month label
    await expect(select.locator("option:checked")).toHaveText(expectedLabel);
  });

  test("selecting a different month refreshes dashboard metrics", async ({ page }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    // Seed current month with specific values
    await seedDashboardSummary();

    // Seed a previous month with different values
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedSummaryForMonth(prevMonth, prevYear, {
      totalSeats: 77,
      activeSeats: 55,
      totalSpending: 1500.0,
      seatBaseCost: 300.0,
      totalAiCredits: 8000,
      modelUsage: [
        { model: "Claude Haiku 4.5", totalRequests: 200, totalAmount: 800.0 },
      ],
      mostActiveUsers: [
        { seatId: 3, githubUsername: "prev-top-user", firstName: "Prev", lastName: "Top", totalRequests: 300, totalSpending: 150.0 },
      ],
      leastActiveUsers: [
        { seatId: 4, githubUsername: "prev-low-user", firstName: "Prev", lastName: "Low", totalRequests: 2, totalSpending: 1.0 },
      ],
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    // Verify current month data is displayed
    await expect(page.getByText("GPT-4o")).toBeVisible();
    await expect(page.getByText("top-user-1")).toBeVisible();

    // Switch to previous month
    const select = page.getByLabel("Month", { exact: true });
    await select.selectOption(`${prevMonth}-${prevYear}`);

    // Verify metrics update — previous month data
    await expect(page.getByText("Claude Haiku 4.5")).toBeVisible();
    await expect(page.getByText("prev-top-user")).toBeVisible();
  });

  test("all months with available data appear as options in the dropdown", async ({ page }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    // Seed 3 months of data
    await seedDashboardSummary(); // current month

    const prevMonth1 = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear1 = currentMonth === 1 ? currentYear - 1 : currentYear;

    const prevMonth2 = currentMonth <= 2 ? (currentMonth === 1 ? 11 : 12) : currentMonth - 2;
    const prevYear2 = currentMonth <= 2 ? currentYear - 1 : currentYear;

    await seedSummaryForMonth(prevMonth1, prevYear1);
    await seedSummaryForMonth(prevMonth2, prevYear2);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const select = page.getByLabel("Month");
    await expect(select).toBeVisible();

    // Verify all 3 months appear as options
    const options = select.locator("option");
    await expect(options).toHaveCount(3);

    const expectedLabel1 = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
    const expectedLabel2 = `${MONTH_NAMES[prevMonth1 - 1]} ${prevYear1}`;
    const expectedLabel3 = `${MONTH_NAMES[prevMonth2 - 1]} ${prevYear2}`;

    await expect(options.filter({ hasText: expectedLabel1 })).toHaveCount(1);
    await expect(options.filter({ hasText: expectedLabel2 })).toHaveCount(1);
    await expect(options.filter({ hasText: expectedLabel3 })).toHaveCount(1);
  });

  test("most active user rows are clickable links to seat detail", async ({ page }) => {
    await seedDashboardSummary();
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const mostActiveHeading = page.getByRole("heading", { name: /most active users/i });
    const mostActiveCard = mostActiveHeading.locator("../..");
    const firstUserLink = mostActiveCard.getByRole("link", { name: /top-user-1/i });
    await expect(firstUserLink).toBeVisible();
    await expect(firstUserLink).toHaveAttribute("href", /\/usage\/seats\/101\?month=\d+&year=\d+/);
  });

});
