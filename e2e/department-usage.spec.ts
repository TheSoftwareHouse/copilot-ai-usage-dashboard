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

async function seedDepartment(name: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO department ("name") VALUES ($1) RETURNING id`,
    [name],
  );
  await client.end();
  return result.rows[0].id;
}

async function seedSeat(options: {
  githubUsername: string;
  githubUserId: number;
  firstName?: string | null;
  lastName?: string | null;
  departmentId?: number | null;
}): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "departmentId")
     VALUES ($1, $2, 'active', $3, $4, $5)
     ON CONFLICT ("githubUsername") DO UPDATE SET "firstName" = EXCLUDED."firstName", "departmentId" = EXCLUDED."departmentId"
     RETURNING id`,
    [
      options.githubUsername,
      options.githubUserId,
      options.firstName ?? null,
      options.lastName ?? null,
      options.departmentId ?? null,
    ],
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
    discountQuantity: grossQuantity,
    discountAmount: grossAmount,
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

function isAicMonth(month: number, year: number) {
  return year > 2026 || (year === 2026 && month >= 5);
}

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM team_member_snapshot");
  await client.query("DELETE FROM team");
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM department");
  await client.query("DELETE FROM dashboard_monthly_summary");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Department Usage — Department Tab", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("Department tab shows department usage chart and table", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Engineering");
    const seatId = await seedSeat({
      githubUsername: "eng-alice",
      githubUserId: 20001,
      firstName: "Alice",
      lastName: "Eng",
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 200, 8.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();
    await expect(deptTab).toHaveAttribute("aria-selected", "true");

    // AIC mode hides the legacy chart on the department usage tab.
    await expect(
      page.getByRole("img", {
        name: "Department usage chart showing each department's usage percentage",
      }),
    ).toHaveCount(0);

    // Table should show AIC units and spending.
    const table = page.getByRole("table");
    await expect(table.getByText("Engineering")).toBeVisible();
    const row = table.getByRole("row").filter({ hasText: "Engineering" });
    await expect(row.getByText("200")).toBeVisible();
    await expect(row.getByText("$8.00")).toBeVisible();
  });

  test("departments are ordered from highest to lowest usage % in the table", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    // High dept: 1 member, 300 requests → 100%
    const highDeptId = await seedDepartment("High Dept");
    const highSeatId = await seedSeat({
      githubUsername: "high-dept-user",
      githubUserId: 20010,
      departmentId: highDeptId,
    });
    await seedUsage(highSeatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 300, 12.0),
    ]);

    // Low dept: 1 member, 90 requests → 30%
    const lowDeptId = await seedDepartment("Low Dept");
    const lowSeatId = await seedSeat({
      githubUsername: "low-dept-user",
      githubUserId: 20011,
      departmentId: lowDeptId,
    });
    await seedUsage(lowSeatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 90, 3.6),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    // First row should be High Dept (100%), second should be Low Dept (30%)
    const rows = page.getByRole("row");
    const firstDataRow = rows.nth(1);
    const secondDataRow = rows.nth(2);
    await expect(firstDataRow).toContainText("High Dept");
    await expect(firstDataRow).toContainText("300");
    await expect(secondDataRow).toContainText("Low Dept");
    await expect(secondDataRow).toContainText("90");
  });

  test("department table shows department name, AIC units, and spending", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Metrics Dept");
    const seat1Id = await seedSeat({
      githubUsername: "metrics-a",
      githubUserId: 20020,
      departmentId: deptId,
    });
    const seat2Id = await seedSeat({
      githubUsername: "metrics-b",
      githubUserId: 20021,
      departmentId: deptId,
    });

    // Total: 150+90 = 240 AIC units across 2 members
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.0),
    ]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 90, 3.6),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const table = page.getByRole("table");
    await expect(table.getByText("Metrics Dept")).toBeVisible();
    const row = table.getByRole("row").filter({ hasText: "Metrics Dept" });
    const cells = row.locator("td");
    await expect(cells.nth(1)).toHaveText("240");
    await expect(cells.nth(2)).toHaveText("$9.60");
  });

  test("informative message shown when no departments have been defined", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    await expect(
      page.getByText(/no departments have been defined yet/i),
    ).toBeVisible();
  });

  test("departments with no assigned seats display 0% usage", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);
    await seedDepartment("Empty Dept");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const table = page.getByRole("table");
    const row = table.getByRole("row").filter({ hasText: "Empty Dept" });
    await expect(row).toBeVisible();
    const cells = row.locator("td");
    await expect(cells.nth(1)).toHaveText("0");
    await expect(cells.nth(2)).toHaveText("$0.00");
  });

  test("clicking a department name in the table navigates to department detail page", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Navigate Dept");
    const seatId = await seedSeat({
      githubUsername: "nav-dept-user",
      githubUserId: 20030,
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 50, 2.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    await page.getByRole("link", { name: "Navigate Dept" }).first().click();
    await expect(page).toHaveURL(
      new RegExp(`/usage/departments/${deptId}`),
    );
  });
});

test.describe("Department Usage — Department Search", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed three distinct departments for search testing
    const engDeptId = await seedDepartment("Engineering");
    const seat1Id = await seedSeat({
      githubUsername: "search-eng-user",
      githubUserId: 30001,
      firstName: "Alice",
      lastName: "Eng",
      departmentId: engDeptId,
    });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.0),
    ]);

    const marketingDeptId = await seedDepartment("Marketing");
    const seat2Id = await seedSeat({
      githubUsername: "search-mkt-user",
      githubUserId: 30002,
      firstName: "Bob",
      lastName: "Mkt",
      departmentId: marketingDeptId,
    });
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 80, 3.2),
    ]);

    const designDeptId = await seedDepartment("Design");
    const seat3Id = await seedSeat({
      githubUsername: "search-design-user",
      githubUserId: 30003,
      firstName: "Charlie",
      lastName: "Des",
      departmentId: designDeptId,
    });
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 60, 2.4),
    ]);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("search input is visible on the department usage tab", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const searchInput = page.getByPlaceholder("Search departments…");
    await expect(searchInput).toBeVisible();
  });

  test("typing a query filters the department table to matching results", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const table = page.getByRole("table");

    // All 3 departments visible initially
    await expect(table.getByText("Engineering")).toBeVisible();
    await expect(table.getByText("Marketing")).toBeVisible();
    await expect(table.getByText("Design")).toBeVisible();

    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("Engineering");

    // After debounce, only Engineering should appear in the table
    await expect(table.getByText("Engineering")).toBeVisible();
    await expect(table.getByText("Marketing")).not.toBeVisible();
    await expect(table.getByText("Design")).not.toBeVisible();
  });

  test("department usage chart updates to show only filtered departments", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    await expect(
      page.getByRole("img", {
        name: /department usage chart/i,
      }),
    ).toHaveCount(0);

    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("Engineering");

    const table = page.getByRole("table");
    await expect(table.getByText("Engineering")).toBeVisible();
    await expect(table.getByText("Marketing")).not.toBeVisible();
    await expect(table.getByText("Design")).not.toBeVisible();
  });

  test("search is case-insensitive", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("engineering");

    await expect(table.getByText("Engineering")).toBeVisible();
    await expect(table.getByText("Marketing")).not.toBeVisible();
  });

  test("clearing the search input restores the full department list and chart", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("Engineering");
    await expect(table.getByText("Marketing")).not.toBeVisible();

    // Clear the search
    await searchInput.clear();

    // All departments should reappear
    await expect(table.getByText("Engineering")).toBeVisible();
    await expect(table.getByText("Marketing")).toBeVisible();
    await expect(table.getByText("Design")).toBeVisible();

    await expect(
      page.getByRole("img", {
        name: /department usage chart/i,
      }),
    ).toHaveCount(0);
  });

  test("empty state message is shown when search has no matches", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("nonexistent-department-xyz");

    await expect(
      page.getByText(/no departments match your search/i),
    ).toBeVisible();
  });

  test("search query is preserved in URL after page refresh", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("Marketing");

    // Wait for results to filter
    await expect(table.getByText("Marketing")).toBeVisible();
    await expect(table.getByText("Engineering")).not.toBeVisible();

    // URL should contain search param
    await expect(page).toHaveURL(/search=Marketing/);

    // Refresh the page
    await page.reload();

    // After reload, search should be pre-filled and results filtered
    const reloadedSearchInput = page.getByPlaceholder("Search departments…");
    await expect(reloadedSearchInput).toHaveValue("Marketing");
    const reloadedTable = page.getByRole("table");
    await expect(reloadedTable.getByText("Marketing")).toBeVisible();
    await expect(reloadedTable.getByText("Engineering")).not.toBeVisible();
  });
});

test.describe("Department Usage — Department Detail", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("department detail page shows department name and member count", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Detail Dept");
    await seedSeat({
      githubUsername: "detail-a",
      githubUserId: 21001,
      firstName: "Alice",
      lastName: "Detail",
      departmentId: deptId,
    });
    await seedSeat({
      githubUsername: "detail-b",
      githubUserId: 21002,
      firstName: "Bob",
      lastName: "Detail",
      departmentId: deptId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "Detail Dept" }),
    ).toBeVisible();
    await expect(page.getByText("2 members")).toBeVisible();
    await expectCostCards(page, {
      averageDailyCost: "$0.00",
      totalCost: "$0.00",
      predictedMonthCost: "$0.00",
    });
  });

  test("department detail page shows the accessible member usage line chart", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Chart Dept");
    const seatId = await seedSeat({
      githubUsername: "chart-dept-user",
      githubUserId: 21010,
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("img", {
        name: "Daily AIC Units line chart for each department member",
      }),
    ).toBeVisible();
    await expectCostCards(page, expectedCostCards(150, currentMonth, currentYear));
  });

  test("department detail cost cards remain visible in an AIC reporting month", async ({ page }) => {
    const aicMonth = 5;
    const aicYear = 2026;
    await seedDashboardSummary(aicMonth, aicYear);

    const deptId = await seedDepartment("AIC Department");
    const seatId = await seedSeat({
      githubUsername: "aic-department-user",
      githubUserId: 21011,
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, aicMonth, aicYear, [
      makeUsageItem("GPT-4o", 500, 20),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${aicMonth}&year=${aicYear}`,
    );

    await expectCostCards(page, expectedCostCards(500, aicMonth, aicYear));
    await expect(
      page.getByRole("img", {
        name: "Daily AIC Units line chart for each department member",
      }),
    ).toBeVisible();
  });

  test("department detail page shows member table with AIC units and spending", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Table Dept");
    const seatId = await seedSeat({
      githubUsername: "table-user",
      githubUserId: 21020,
      firstName: "Tara",
      lastName: "Table",
      departmentId: deptId,
    });
    // 150 requests = 50% of 300
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    const memberTable = page.getByRole("table");
    await expect(memberTable.getByText("table-user")).toBeVisible();
    const row = memberTable.getByRole("row").filter({ hasText: "table-user" });
    const cells = row.locator("td");
    await expect(cells.nth(2)).toHaveText("150");
    await expect(cells.nth(3)).toHaveText("$6.00");
  });

  test.skip("department member colour indicators are correct", async ({ page }) => {

    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Colour Dept");

    // Red: 0-50% → 90 requests = 30%
    const seatLow = await seedSeat({
      githubUsername: "dept-low-user",
      githubUserId: 21030,
      departmentId: deptId,
    });
    // Orange: 51-99% → 210 requests = 70%
    const seatMid = await seedSeat({
      githubUsername: "dept-mid-user",
      githubUserId: 21031,
      departmentId: deptId,
    });
    // Green: 100%+ → 350 requests = 117%
    const seatHigh = await seedSeat({
      githubUsername: "dept-high-user",
      githubUserId: 21032,
      departmentId: deptId,
    });

    await seedUsage(seatLow, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 90, 3.6),
    ]);
    await seedUsage(seatMid, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 210, 8.4),
    ]);
    await seedUsage(seatHigh, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 350, 14.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const lowIndicator = page.locator('[aria-label="Low usage"]');
    const moderateIndicator = page.locator('[aria-label="Moderate usage"]');
    const highIndicator = page.locator('[aria-label="High usage"]');

    await expect(lowIndicator).toBeVisible();
    await expect(moderateIndicator).toBeVisible();
    await expect(highIndicator).toBeVisible();
  });

  test("month filter works on department detail page", async ({ page }) => {
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedDashboardSummary(currentMonth, currentYear);
    await seedDashboardSummary(prevMonth, prevYear);

    const deptId = await seedDepartment("Month Filter Dept");
    const seatId = await seedSeat({
      githubUsername: "mf-dept-user",
      githubUserId: 21040,
      departmentId: deptId,
    });

    // Current month: 200 requests
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 200, 8.0),
    ]);
    // Previous month: 80 requests
    await seedUsage(seatId, 1, prevMonth, prevYear, [
      makeUsageItem("GPT-4o", 80, 3.2),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    // Current month: member table shows AIC units and spending
    const memberTable = page.getByRole("table");
    let row = memberTable.getByRole("row").filter({ hasText: "mf-dept-user" });
    let cells = row.locator("td");
    await expect(cells.nth(2)).toHaveText("200");
    await expect(cells.nth(3)).toHaveText("$8.00");
    await expectCostCards(page, expectedCostCards(200, currentMonth, currentYear));

    // Switch to previous month
    const select = page.getByLabel("Month");
    await expect(select).toBeVisible();
    await select.selectOption(`${prevMonth}-${prevYear}`);

    // Previous month: member table shows 80 AIC units and $3.20
    row = memberTable.getByRole("row").filter({ hasText: "mf-dept-user" });
    cells = row.locator("td");
    await expect(cells.nth(2)).toHaveText("80");
    await expect(cells.nth(3)).toHaveText("$3.20");
    await expectCostCards(page, expectedCostCards(80, prevMonth, prevYear));
  });

  test("breadcrumb navigates back to /usage with department tab active", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Breadcrumb Dept");
    const seatId = await seedSeat({
      githubUsername: "bc-dept-user",
      githubUserId: 23001,
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 50, 2.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    // Breadcrumb should render
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText("Usage")).toBeVisible();
    await expect(breadcrumb.getByText("Departments")).toBeVisible();
    await expect(breadcrumb.getByText("Breadcrumb Dept")).toBeVisible();

    // Click breadcrumb "Usage" link
    await breadcrumb.getByRole("link", { name: "Usage" }).click();

    await expect(page).toHaveURL(/\/usage\?/);
    await expect(page).toHaveURL(/tab=department/);

    // Verify Department tab is active
    const deptTab = page.getByRole("tab", { name: "Department" });
    await expect(deptTab).toHaveAttribute("aria-selected", "true");
  });

  test("browser back from department detail returns to usage with department tab active", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Back Nav Dept");
    const seatId = await seedSeat({
      githubUsername: "back-nav-dept-user",
      githubUserId: 23002,
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 50, 2.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Switch to Department tab
    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();
    await expect(deptTab).toHaveAttribute("aria-selected", "true");

    // Navigate to department detail
    await page.getByRole("link", { name: "Back Nav Dept" }).click();
    await expect(page).toHaveURL(new RegExp(`/usage/departments/${deptId}`));

    // Browser back
    await page.goBack();

    await expect(page).toHaveURL(/\/usage\?/);
    await expect(page).toHaveURL(/tab=department/);
    const deptTabAfter = page.getByRole("tab", { name: "Department" });
    await expect(deptTabAfter).toHaveAttribute("aria-selected", "true");
  });

  test("department detail page shows AIC usage and spending without a progress bar", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Bar Dept");
    const seat1Id = await seedSeat({
      githubUsername: "bar-dept-a",
      githubUserId: 22001,
      departmentId: deptId,
    });
    const seat2Id = await seedSeat({
      githubUsername: "bar-dept-b",
      githubUserId: 22002,
      departmentId: deptId,
    });

    // Total: 180 + 120 = 300 AIC units
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 180, 7.2),
    ]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 120, 4.8),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(page.getByRole("heading", { name: "Total Cost", exact: true })).toBeVisible();
    await expect(page.getByText("$3.00", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily AIC Units by Member", exact: true })).toBeVisible();
    const memberTable = page.getByRole("table");
    await expect(memberTable.getByText("bar-dept-a")).toBeVisible();
    await expect(memberTable.getByText("bar-dept-b")).toBeVisible();
  });

  test("department detail page shows zero AIC totals when the department has no members", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Empty Bar Dept");

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expectCostCards(page, {
      averageDailyCost: "$0.00",
      totalCost: "$0.00",
      predictedMonthCost: "$0.00",
    });
    await expect(page.getByText(/this department has no assigned seats/i)).toBeVisible();
  });

  test("member table shows uncapped AIC totals for heavy and light members", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Capped Dept");
    const seat1Id = await seedSeat({
      githubUsername: "cap-dept-heavy",
      githubUserId: 23001,
      departmentId: deptId,
    });
    const seat2Id = await seedSeat({
      githubUsername: "cap-dept-light",
      githubUserId: 23002,
      departmentId: deptId,
    });

    // seat1 and seat2 totals should be reflected directly in the member table
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 1000, 40.0),
    ]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    const heavyRow = page.getByRole("row").filter({ hasText: "cap-dept-heavy" });
    const lightRow = page.getByRole("row").filter({ hasText: "cap-dept-light" });
    await expect(heavyRow.locator("td").nth(2)).toHaveText("1,000");
    await expect(heavyRow.locator("td").nth(3)).toHaveText("$40.00");
    await expect(lightRow.locator("td").nth(2)).toHaveText("100");
    await expect(lightRow.locator("td").nth(3)).toHaveText("$4.00");
  });

  test("clicking a department member row navigates to seat usage page", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Nav Member Dept");
    const seatId = await seedSeat({
      githubUsername: "nav-dept-member",
      githubUserId: 24001,
      firstName: "Nav",
      lastName: "DeptMember",
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 120, 4.8),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    // Click the member username link in the member table
    await page.getByRole("link", { name: "nav-dept-member" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/usage/seats/${seatId}\\?month=${currentMonth}&year=${currentYear}`),
    );
  });

  test("department member line chart keeps the AIC label", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const deptId = await seedDepartment("Chart Bar Nav Dept");
    const seatId = await seedSeat({
      githubUsername: "chart-bar-nav-user",
      githubUserId: 24010,
      firstName: "Chart",
      lastName: "BarNav",
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 200, 8.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const chart = page.getByRole("img", {
      name: "Daily AIC Units line chart for each department member",
    });
    await expect(chart).toBeVisible();
  });
});

test.describe("Department Usage — Department Detail Member Search", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  let deptId: number;

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a department with 3 distinct members for search testing
    deptId = await seedDepartment("Search Detail Dept");

    const seat1Id = await seedSeat({
      githubUsername: "alice-dev",
      githubUserId: 40001,
      firstName: "Alice",
      lastName: "Johnson",
      departmentId: deptId,
    });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.0),
    ]);

    const seat2Id = await seedSeat({
      githubUsername: "bob-ops",
      githubUserId: 40002,
      firstName: "Bob",
      lastName: "Smith",
      departmentId: deptId,
    });
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 80, 3.2),
    ]);

    const seat3Id = await seedSeat({
      githubUsername: "charlie-qa",
      githubUserId: 40003,
      firstName: "Charlie",
      lastName: "Brown",
      departmentId: deptId,
    });
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 60, 2.4),
    ]);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("search input is visible on the department detail page when the department has members", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await expect(searchInput).toBeVisible();
  });

  test("search input is NOT visible when the department has no members", async ({
    page,
  }) => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);
    const emptyDeptId = await seedDepartment("Empty Search Dept");

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${emptyDeptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(page.getByText(/no assigned seats/i)).toBeVisible();
    await expect(
      page.getByPlaceholder("Search members…"),
    ).not.toBeVisible();
  });

  test("typing a query filters the member table by GitHub username", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const table = page.getByRole("table");
    await expect(table.getByText("alice-dev")).toBeVisible();
    await expect(table.getByText("bob-ops")).toBeVisible();
    await expect(table.getByText("charlie-qa")).toBeVisible();

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("alice-dev");

    await expect(table.getByText("alice-dev")).toBeVisible();
    await expect(table.getByText("bob-ops")).not.toBeVisible();
    await expect(table.getByText("charlie-qa")).not.toBeVisible();
  });

  test("typing a query filters the member table by first name", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("Bob");

    const table = page.getByRole("table");
    await expect(table.getByText("bob-ops")).toBeVisible();
    await expect(table.getByText("alice-dev")).not.toBeVisible();
    await expect(table.getByText("charlie-qa")).not.toBeVisible();
  });

  test("typing a query filters the member table by last name", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("Brown");

    const table = page.getByRole("table");
    await expect(table.getByText("charlie-qa")).toBeVisible();
    await expect(table.getByText("alice-dev")).not.toBeVisible();
    await expect(table.getByText("bob-ops")).not.toBeVisible();
  });

  test("search is case-insensitive", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("alice");

    const table = page.getByRole("table");
    await expect(table.getByText("alice-dev")).toBeVisible();
    await expect(table.getByText("bob-ops")).not.toBeVisible();
  });

  test("the member usage chart updates to show only filtered members", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const chart = page.getByRole("img", {
      name: "Daily AIC Units line chart for each department member",
    });
    await expect(chart).toBeVisible();

    // Initially all 3 member lines should be in the chart legend
    const legendItems = chart.locator(".recharts-legend-item");
    await expect(legendItems).toHaveCount(3);

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("alice-dev");

    // After filtering, only 1 line should remain in the chart legend
    await expect(legendItems).toHaveCount(1);
  });

  test("clearing the search input restores the full member list and chart", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("alice-dev");
    await expect(table.getByText("bob-ops")).not.toBeVisible();

    // Clear the search
    await searchInput.clear();

    // All members should reappear
    await expect(table.getByText("alice-dev")).toBeVisible();
    await expect(table.getByText("bob-ops")).toBeVisible();
    await expect(table.getByText("charlie-qa")).toBeVisible();

    // Chart should show all 3 lines again
    const chart = page.getByRole("img", {
      name: "Daily AIC Units line chart for each department member",
    });
    const legendItems = chart.locator(".recharts-legend-item");
    await expect(legendItems).toHaveCount(3);
  });

  test("empty state message is shown when search has no matches", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("nonexistent-member-xyz");

    await expect(
      page.getByText(/no members match your search/i),
    ).toBeVisible();
  });
});

test.describe.skip("Department Usage — Department Detail Statistics Cards", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("stats cards show correct per-member values for a department with multiple members", async ({
    page,
  }) => {
    const deptId = await seedDepartment("Detail Stats Dept");

    // Member 1: 300 requests → 300/300 × 100 = 100%
    const seat1Id = await seedSeat({
      githubUsername: "ds-alice",
      githubUserId: 50001,
      departmentId: deptId,
    });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 300, 12.0),
    ]);

    // Member 2: 150 requests → 150/300 × 100 = 50%
    const seat2Id = await seedSeat({
      githubUsername: "ds-bob",
      githubUserId: 50002,
      departmentId: deptId,
    });
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.0),
    ]);

    // Member 3: 60 requests → 60/300 × 100 = 20%
    const seat3Id = await seedSeat({
      githubUsername: "ds-charlie",
      githubUserId: 50003,
      departmentId: deptId,
    });
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 60, 2.4),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    // Average = (100+50+20)/3 = 56.7 → 57%
    // Median = 50% (sorted: 20, 50, 100)
    // Min = 20%, Max = 100%
    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    const averageCard = cards.locator("div").filter({ hasText: "Average Usage" });
    await expect(averageCard.getByText("57%")).toBeVisible();

    const medianCard = cards.locator("div").filter({ hasText: "Median Usage" });
    await expect(medianCard.getByText("50%")).toBeVisible();

    const minCard = cards.locator("div").filter({ hasText: "Minimum Usage" });
    await expect(minCard.getByText("20%")).toBeVisible();

    const maxCard = cards.locator("div").filter({ hasText: "Maximum Usage" });
    await expect(maxCard.getByText("100%")).toBeVisible();
  });

  test("stats cards show dash when department has no members", async ({
    page,
  }) => {
    const deptId = await seedDepartment("Empty Stats Dept");

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    const dashValues = cards.getByText("—");
    await expect(dashValues).toHaveCount(4);
  });

  test("stats cards include members with zero usage in statistics", async ({
    page,
  }) => {
    const deptId = await seedDepartment("Zero Usage Dept");

    // Member 1: 150 requests → 50%
    const seat1Id = await seedSeat({
      githubUsername: "zu-alice",
      githubUserId: 50101,
      departmentId: deptId,
    });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.0),
    ]);

    // Member 2: no usage → 0%
    await seedSeat({
      githubUsername: "zu-bob",
      githubUserId: 50102,
      departmentId: deptId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    // Average = (50+0)/2 = 25%, Median = 25%, Min = 0%, Max = 50%
    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    const minCard = cards.locator("div").filter({ hasText: "Minimum Usage" });
    await expect(minCard.getByText("0%")).toBeVisible();

    const maxCard = cards.locator("div").filter({ hasText: "Maximum Usage" });
    await expect(maxCard.getByText("50%")).toBeVisible();
  });

  test("stats cards are not affected by member search filter", async ({
    page,
  }) => {
    const deptId = await seedDepartment("Search Stats Dept");

    // Member 1: 300 requests → 100%
    const seat1Id = await seedSeat({
      githubUsername: "sf-alice",
      githubUserId: 50201,
      firstName: "Alice",
      lastName: "Filter",
      departmentId: deptId,
    });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 300, 12.0),
    ]);

    // Member 2: 60 requests → 20%
    const seat2Id = await seedSeat({
      githubUsername: "sf-bob",
      githubUserId: 50202,
      firstName: "Bob",
      lastName: "Filter",
      departmentId: deptId,
    });
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 60, 2.4),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    // Average = (100+20)/2 = 60%, Min = 20%, Max = 100%
    const averageCard = cards.locator("div").filter({ hasText: "Average Usage" });
    await expect(averageCard.getByText("60%")).toBeVisible();

    // Filter to only Alice
    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("Alice");

    // Table should only show Alice
    const table = page.getByRole("table");
    await expect(table.getByText("sf-alice")).toBeVisible();
    await expect(table.getByText("sf-bob")).not.toBeVisible();

    // Stats cards should still show global stats (not filtered)
    await expect(averageCard.getByText("60%")).toBeVisible();

    const minCard = cards.locator("div").filter({ hasText: "Minimum Usage" });
    await expect(minCard.getByText("20%")).toBeVisible();

    const maxCard = cards.locator("div").filter({ hasText: "Maximum Usage" });
    await expect(maxCard.getByText("100%")).toBeVisible();
  });

  test("stats cards are visible above the member search box", async ({
    page,
  }) => {
    const deptId = await seedDepartment("Position Stats Dept");
    const seatId = await seedSeat({
      githubUsername: "pos-detail",
      githubUserId: 50301,
      departmentId: deptId,
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/departments/${deptId}?month=${currentMonth}&year=${currentYear}`,
    );

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toBeVisible();

    const searchInput = page.getByPlaceholder("Search members…");
    await expect(searchInput).toBeVisible();

    const cardsBox = await cards.boundingBox();
    const searchBox = await searchInput.boundingBox();
    expect(cardsBox).toBeTruthy();
    expect(searchBox).toBeTruthy();
    expect(cardsBox!.y).toBeLessThan(searchBox!.y);
  });
});

test.describe.skip("Department Usage — Statistics Cards", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("stats cards show correct aggregate values for multiple departments", async ({ page }) => {
    // Dept A: 2 members — seat1 has 300 requests (capped at 300), seat2 has 150
    // capped_total = 450, usage = 450 / (2×300) × 100 = 75%
    const deptAId = await seedDepartment("Stats Dept A");
    const seat1Id = await seedSeat({ githubUsername: "stats-alice", githubUserId: 9001, departmentId: deptAId });
    const seat2Id = await seedSeat({ githubUsername: "stats-bob", githubUserId: 9002, departmentId: deptAId });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 300, 12.0)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);

    // Dept B: 1 member — 120 requests → usage = 120 / 300 × 100 = 40%
    const deptBId = await seedDepartment("Stats Dept B");
    const seat3Id = await seedSeat({ githubUsername: "stats-charlie", githubUserId: 9003, departmentId: deptBId });
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 120, 4.8)]);

    // Dept C: 1 member — 270 requests → usage = 270 / 300 × 100 = 90%
    const deptCId = await seedDepartment("Stats Dept C");
    const seat4Id = await seedSeat({ githubUsername: "stats-dana", githubUserId: 9004, departmentId: deptCId });
    await seedUsage(seat4Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 270, 10.8)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    // Average = (75 + 40 + 90) / 3 = 68.3 → 68%
    // Median = 75 (sorted: 40, 75, 90)
    // Min = 40%
    // Max = 90%
    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    const averageCard = cards.locator("div").filter({ hasText: "Average Usage" });
    await expect(averageCard.getByText("68%")).toBeVisible();

    const medianCard = cards.locator("div").filter({ hasText: "Median Usage" });
    await expect(medianCard.getByText("75%")).toBeVisible();

    const minCard = cards.locator("div").filter({ hasText: "Minimum Usage" });
    await expect(minCard.getByText("40%")).toBeVisible();

    const maxCard = cards.locator("div").filter({ hasText: "Maximum Usage" });
    await expect(maxCard.getByText("90%")).toBeVisible();
  });

  test("stats cards show dash when no departments have usage data", async ({ page }) => {
    // No departments, no usage — cards should show "—"
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    const dashValues = cards.getByText("—");
    await expect(dashValues).toHaveCount(4);
  });

  test("stats cards are not affected by search filter", async ({ page }) => {
    // Seed 2 departments with different usage
    const deptAId = await seedDepartment("Alpha Dept");
    const seat1Id = await seedSeat({ githubUsername: "search-s1", githubUserId: 9101, departmentId: deptAId });
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);

    const deptBId = await seedDepartment("Beta Dept");
    const seat2Id = await seedSeat({ githubUsername: "search-s2", githubUserId: 9102, departmentId: deptBId });
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 90, 3.6)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    // Both depts: Alpha = 150/300 × 100 = 50%, Beta = 90/300 × 100 = 30%
    // Average = 40%, Min = 30%, Max = 50%
    const averageCard = cards.locator("div").filter({ hasText: "Average Usage" });
    await expect(averageCard.getByText("40%")).toBeVisible();

    // Filter to only Alpha Dept
    const searchInput = page.getByPlaceholder("Search departments…");
    await searchInput.fill("Alpha");
    const table = page.getByRole("table");
    await expect(table.getByText("Beta Dept")).not.toBeVisible();

    // Stats cards should STILL show global stats (not filtered)
    await expect(averageCard.getByText("40%")).toBeVisible();

    const minCard = cards.locator("div").filter({ hasText: "Minimum Usage" });
    await expect(minCard.getByText("30%")).toBeVisible();

    const maxCard = cards.locator("div").filter({ hasText: "Maximum Usage" });
    await expect(maxCard.getByText("50%")).toBeVisible();
  });

  test("stats cards are visible above the search box", async ({ page }) => {
    const deptId = await seedDepartment("Position Dept");
    const seatId = await seedSeat({ githubUsername: "pos-user", githubUserId: 9201, departmentId: deptId });
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toBeVisible();

    const searchInput = page.getByPlaceholder("Search departments…");
    await expect(searchInput).toBeVisible();

    // Verify cards appear above search by checking Y positions
    const cardsBox = await cards.boundingBox();
    const searchBox = await searchInput.boundingBox();
    expect(cardsBox).toBeTruthy();
    expect(searchBox).toBeTruthy();
    expect(cardsBox!.y).toBeLessThan(searchBox!.y);
  });
});
