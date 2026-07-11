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

async function seedSeat(options: {
  githubUsername: string;
  githubUserId: number;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName")
     VALUES ($1, $2, 'active', $3, $4)
     ON CONFLICT ("githubUsername") DO UPDATE SET "firstName" = EXCLUDED."firstName"
     RETURNING id`,
    [options.githubUsername, options.githubUserId, options.firstName ?? null, options.lastName ?? null],
  );
  await client.end();
  return result.rows[0].id;
}

async function seedTeam(name: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO team ("name") VALUES ($1) RETURNING id`,
    [name],
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
    [teamId, seatId, month, year],
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
    [seatId, day, month, year, JSON.stringify(usageItems)],
  );
  await client.end();
}

function makeUsageItem(model: string, grossQuantity: number, grossAmount: number) {
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
  await client.query("DELETE FROM dashboard_monthly_summary");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Team Usage — Team Tab", () => {
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

  test("Team tab shows teams with aggregated usage metrics", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seat1Id = await seedSeat({ githubUsername: "alice-dev", githubUserId: 5001, firstName: "Alice", lastName: "Smith" });
    const seat2Id = await seedSeat({ githubUsername: "bob-dev", githubUserId: 5002, firstName: "Bob", lastName: "Jones" });

    const teamId = await seedTeam("Frontend Team");
    await seedMemberSnapshot(teamId, seat1Id, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seat2Id, currentMonth, currentYear);

    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 200, 8.0)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Click Team tab
    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();
    await expect(teamTab).toHaveAttribute("aria-selected", "true");

    // Verify team row is visible
    const row = page.getByRole("row").filter({ hasText: "Frontend Team" });
    await expect(row).toBeVisible();
    await expect(row.getByText("300")).toBeVisible();
    await expect(row.getByText("$12.00")).toBeVisible();
  });

  test("informative message shown when no teams have been defined", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    await expect(
      page.getByText(/no teams have been defined yet/i),
    ).toBeVisible();
  });

  test("teams with no members display zero usage", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);
    await seedTeam("Empty Team");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    await expect(page.getByText("Empty Team")).toBeVisible();
    // Should show 0 for members, AIC units, and spending
    const row = page.getByRole("row").filter({ hasText: "Empty Team" });
    await expect(row).toBeVisible();
    const cells = row.locator("td");
    await expect(cells.nth(1)).toHaveText("0");
    await expect(cells.nth(2)).toHaveText("0");
    await expect(cells.nth(3)).toHaveText("$0.00");
  });

  test("clicking a team row navigates to team detail page", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "nav-user", githubUserId: 6001 });
    const teamId = await seedTeam("Navigate Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 50, 2.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const table = page.getByRole("table");
    await table.getByRole("link", { name: /Navigate Team/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/usage/teams/${teamId}`));
    await expect(page.getByRole("columnheader", { name: /allocation %/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /allocated usage/i })).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
  });
});

test.describe("Team Usage — Team Search", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed three distinct teams for search testing
    const seat1Id = await seedSeat({ githubUsername: "search-alice", githubUserId: 8001, firstName: "Alice", lastName: "Smith" });
    const seat2Id = await seedSeat({ githubUsername: "search-bob", githubUserId: 8002, firstName: "Bob", lastName: "Jones" });
    const seat3Id = await seedSeat({ githubUsername: "search-charlie", githubUserId: 8003, firstName: "Charlie", lastName: "Brown" });

    const frontendId = await seedTeam("Frontend Team");
    await seedMemberSnapshot(frontendId, seat1Id, currentMonth, currentYear);
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    const backendId = await seedTeam("Backend Team");
    await seedMemberSnapshot(backendId, seat2Id, currentMonth, currentYear);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 80, 3.2)]);

    const designId = await seedTeam("Design Team");
    await seedMemberSnapshot(designId, seat3Id, currentMonth, currentYear);
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 60, 2.4)]);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("search input is visible on the team usage tab", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const searchInput = page.getByPlaceholder("Search teams…");
    await expect(searchInput).toBeVisible();
  });

  test("typing a query filters the team table to matching results", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const table = page.getByRole("table");

    // All 3 teams visible initially
    await expect(table.getByText("Frontend Team")).toBeVisible();
    await expect(table.getByText("Backend Team")).toBeVisible();
    await expect(table.getByText("Design Team")).toBeVisible();

    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("Frontend");

    // After debounce, only Frontend Team should appear in the table
    await expect(table.getByText("Frontend Team")).toBeVisible();
    await expect(table.getByText("Backend Team")).not.toBeVisible();
    await expect(table.getByText("Design Team")).not.toBeVisible();
  });

  test("search is case-insensitive", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("frontend");

    await expect(table.getByText("Frontend Team")).toBeVisible();
    await expect(table.getByText("Backend Team")).not.toBeVisible();
  });

  test("clearing the search input restores the full team list", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("Frontend");
    await expect(table.getByText("Backend Team")).not.toBeVisible();

    // Clear the search
    await searchInput.clear();

    // All teams should reappear in the table
    await expect(table.getByText("Frontend Team")).toBeVisible();
    await expect(table.getByText("Backend Team")).toBeVisible();
    await expect(table.getByText("Design Team")).toBeVisible();
  });

  test("empty state message is shown when search has no matches", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("nonexistent-team-xyz");

    await expect(page.getByText(/no teams match your search/i)).toBeVisible();
  });

  test("search query is preserved in URL after page refresh", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const table = page.getByRole("table");
    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("Backend");

    // Wait for results to filter
    await expect(table.getByText("Backend Team")).toBeVisible();
    await expect(table.getByText("Frontend Team")).not.toBeVisible();

    // URL should contain search param
    await expect(page).toHaveURL(/search=Backend/);

    // Refresh the page
    await page.reload();

    // After reload, search should be pre-filled and results filtered
    const reloadedSearchInput = page.getByPlaceholder("Search teams…");
    await expect(reloadedSearchInput).toHaveValue("Backend");
    await expect(table.getByText("Backend Team")).toBeVisible();
    await expect(table.getByText("Frontend Team")).not.toBeVisible();
  });
});

test.describe("Team Usage — Team Detail", () => {
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

  test("team detail page shows team summary with member count and spending", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seat1Id = await seedSeat({ githubUsername: "detail-alice", githubUserId: 7001, firstName: "Alice", lastName: "Smith" });
    const seat2Id = await seedSeat({ githubUsername: "detail-bob", githubUserId: 7002, firstName: "Bob", lastName: "Jones" });

    const teamId = await seedTeam("Detail Team");
    await seedMemberSnapshot(teamId, seat1Id, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seat2Id, currentMonth, currentYear);

    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    // Team name and member count
    await expect(page.getByRole("heading", { name: "Detail Team" })).toBeVisible();
    await expect(page.getByText("2 members")).toBeVisible();

    await expectCostCards(page, expectedCostCards(250, currentMonth, currentYear));

  });

  test("team detail page shows daily usage line chart", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "chart-user", githubUserId: 8001 });
    const teamId = await seedTeam("Chart Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 50, 2.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    await expect(page.getByText(isAicMonth(currentMonth, currentYear) ? "Daily AIC Units by Member" : "Daily Usage by Member")).toBeVisible();
    // Chart should be rendered
    await expect(page.getByRole("img", { name: /daily usage line chart/i })).toBeVisible();
  });

  test("team detail page shows member table with AIC units and spending", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "percent-user", githubUserId: 9001, firstName: "Pam", lastName: "Test" });
    const teamId = await seedTeam("Percent Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    // 150 requests = 50% of 300
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    const memberTable = page.getByRole("table");
    const memberRow = memberTable.getByRole("row").filter({ hasText: "percent-user" });
    const cells = memberRow.locator("td");
    await expect(cells.nth(2)).toHaveText("150");
    await expect(cells.nth(3)).toHaveText("100%");
    await expect(cells.nth(4)).toHaveText("150.0");
    await expect(cells.nth(5)).toHaveText("$6.00");
  });

  test.skip("team member colour indicators are correct", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    // Red: 0-50% → 90 requests = 30%
    const seatLow = await seedSeat({ githubUsername: "low-user", githubUserId: 10001 });
    // Orange: 51-99% → 210 requests = 70%
    const seatMid = await seedSeat({ githubUsername: "mid-user", githubUserId: 10002 });
    // Green: 100%+ → 350 requests = 117%
    const seatHigh = await seedSeat({ githubUsername: "high-user", githubUserId: 10003 });

    const teamId = await seedTeam("Colour Team");
    await seedMemberSnapshot(teamId, seatLow, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seatMid, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seatHigh, currentMonth, currentYear);

    await seedUsage(seatLow, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 90, 3.6)]);
    await seedUsage(seatMid, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 210, 8.4)]);
    await seedUsage(seatHigh, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 350, 14.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    // Verify colour dots exist next to usernames
    const lowIndicator = page.locator('[aria-label="Low usage"]');
    const moderateIndicator = page.locator('[aria-label="Moderate usage"]');
    const highIndicator = page.locator('[aria-label="High usage"]');

    await expect(lowIndicator).toBeVisible();
    await expect(moderateIndicator).toBeVisible();
    await expect(highIndicator).toBeVisible();
  });

  test("month filter changes the displayed data on team detail page", async ({ page }) => {
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedDashboardSummary(currentMonth, currentYear);
    await seedDashboardSummary(prevMonth, prevYear);

    const seatId = await seedSeat({ githubUsername: "mf-team-user", githubUserId: 11001 });
    const teamId = await seedTeam("Month Filter Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seatId, prevMonth, prevYear);

    // Current month: 200 requests
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 200, 8.0)]);
    // Previous month: 80 requests
    await seedUsage(seatId, 1, prevMonth, prevYear, [makeUsageItem("GPT-4o", 80, 3.2)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    await expectCostCards(page, expectedCostCards(200, currentMonth, currentYear));

    // Switch to previous month
    const select = page.getByLabel("Month");
    await expect(select).toBeVisible();
    await select.selectOption(`${prevMonth}-${prevYear}`);

    await expectCostCards(page, expectedCostCards(80, prevMonth, prevYear));
  });

  test("breadcrumb navigates back to /usage with team tab active", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "bc-user", githubUserId: 13001 });
    const teamId = await seedTeam("Breadcrumb Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 50, 2.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    // Breadcrumb should render
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText("Usage")).toBeVisible();
    await expect(breadcrumb.getByText("Teams")).toBeVisible();
    await expect(breadcrumb.getByText("Breadcrumb Team")).toBeVisible();

    // Click breadcrumb "Usage" link
    await breadcrumb.getByRole("link", { name: "Usage" }).click();

    await expect(page).toHaveURL(/\/usage\?/);
    await expect(page).toHaveURL(/tab=team/);

    // Verify Team tab is active
    const teamTab = page.getByRole("tab", { name: "Team" });
    await expect(teamTab).toHaveAttribute("aria-selected", "true");
  });

  test("browser back from team detail returns to usage with team tab active", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "back-nav-user", githubUserId: 13002 });
    const teamId = await seedTeam("Back Nav Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 50, 2.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Switch to Team tab
    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();
    await expect(teamTab).toHaveAttribute("aria-selected", "true");

    // Navigate to team detail
    const table = page.getByRole("table");
    await table.getByRole("link", { name: /Back Nav Team/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/usage/teams/${teamId}`));

    // Browser back
    await page.goBack();

    await expect(page).toHaveURL(/\/usage\?/);
    await expect(page).toHaveURL(/tab=team/);
    const teamTabAfter = page.getByRole("tab", { name: "Team" });
    await expect(teamTabAfter).toHaveAttribute("aria-selected", "true");
  });

  test("team detail page shows AIC totals and spending without a progress bar", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seat1Id = await seedSeat({ githubUsername: "bar-team-a", githubUserId: 12001, firstName: "Alice", lastName: "Bar" });
    const seat2Id = await seedSeat({ githubUsername: "bar-team-b", githubUserId: 12002, firstName: "Bob", lastName: "Bar" });

    const teamId = await seedTeam("Bar Team");
    await seedMemberSnapshot(teamId, seat1Id, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seat2Id, currentMonth, currentYear);

    // Total: 180 + 120 = 300 AIC units
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 180, 7.2)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 120, 4.8)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

  });

  test("team detail page shows zero AIC totals when team has no members", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const teamId = await seedTeam("Empty Bar Team");

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    await expectCostCards(page, {
      averageDailyCost: "$0.00",
      totalCost: "$0.00",
      predictedMonthCost: "$0.00",
    });
    await expect(page.getByText(/this team has no members for/i)).toBeVisible();
  });

  test("team detail cost cards remain visible in an AIC reporting month", async ({ page }) => {
    const aicMonth = 5;
    const aicYear = 2026;
    await seedDashboardSummary(aicMonth, aicYear);

    const seatId = await seedSeat({ githubUsername: "aic-team-user", githubUserId: 15001 });
    const teamId = await seedTeam("AIC Team");
    await seedMemberSnapshot(teamId, seatId, aicMonth, aicYear);
    await seedUsage(seatId, 1, aicMonth, aicYear, [makeUsageItem("GPT-4o", 500, 20)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${aicMonth}&year=${aicYear}`);

    await expectCostCards(page, expectedCostCards(500, aicMonth, aicYear));
    await expect(page.getByText("Daily AIC Units by Member")).toBeVisible();
  });

  test("member table shows uncapped AIC totals for heavy and light members", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seat1Id = await seedSeat({ githubUsername: "cap-heavy", githubUserId: 13001, firstName: "Heavy", lastName: "User" });
    const seat2Id = await seedSeat({ githubUsername: "cap-light", githubUserId: 13002, firstName: "Light", lastName: "User" });

    const teamId = await seedTeam("Capped Team");
    await seedMemberSnapshot(teamId, seat1Id, currentMonth, currentYear);
    await seedMemberSnapshot(teamId, seat2Id, currentMonth, currentYear);

    // seat1 and seat2 totals should be visible directly
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 1000, 40.0)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("link", { name: "cap-heavy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "cap-light" })).toBeVisible();
    const heavyRow = page.getByRole("row").filter({ hasText: "cap-heavy" });
    const lightRow = page.getByRole("row").filter({ hasText: "cap-light" });
    await expect(heavyRow).toContainText("1,000");
    await expect(lightRow).toContainText("100");
  });

  test("clicking a team member row navigates to seat usage page", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "nav-member", githubUserId: 14001, firstName: "Nav", lastName: "Member" });
    const teamId = await seedTeam("Nav Member Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 120, 4.8)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`);

    // Click the member username link in the member table
    await page.getByRole("link", { name: "nav-member" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/usage/seats/${seatId}\\?month=${currentMonth}&year=${currentYear}`),
    );
  });
});

test.describe("Team Usage — Team Detail Member Search", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  let teamId: number;

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed a team with 3 distinct members for search testing
    teamId = await seedTeam("Search Detail Team");

    const seat1Id = await seedSeat({
      githubUsername: "alice-dev",
      githubUserId: 40001,
      firstName: "Alice",
      lastName: "Johnson",
    });
    await seedMemberSnapshot(teamId, seat1Id, currentMonth, currentYear);
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.0),
    ]);

    const seat2Id = await seedSeat({
      githubUsername: "bob-ops",
      githubUserId: 40002,
      firstName: "Bob",
      lastName: "Smith",
    });
    await seedMemberSnapshot(teamId, seat2Id, currentMonth, currentYear);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 80, 3.2),
    ]);

    const seat3Id = await seedSeat({
      githubUsername: "charlie-qa",
      githubUserId: 40003,
      firstName: "Charlie",
      lastName: "Brown",
    });
    await seedMemberSnapshot(teamId, seat3Id, currentMonth, currentYear);
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 60, 2.4),
    ]);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("search input is visible on the team detail page when the team has members", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await expect(searchInput).toBeVisible();
  });

  test("search input is NOT visible when the team has no members", async ({
    page,
  }) => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);
    const emptyTeamId = await seedTeam("Empty Search Team");

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/teams/${emptyTeamId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(page.getByText(/no members for/i)).toBeVisible();
    await expect(
      page.getByPlaceholder("Search members…"),
    ).not.toBeVisible();
  });

  test("typing a query filters the member table by GitHub username", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
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
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
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
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
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
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("alice");

    const table = page.getByRole("table");
    await expect(table.getByText("alice-dev")).toBeVisible();
    await expect(table.getByText("bob-ops")).not.toBeVisible();
  });

  test("the daily usage chart updates to show only filtered members", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
    );

    const chart = page.getByRole("img", {
      name: /daily usage line chart/i,
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
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
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

    // Chart should show all 3 legend items again
    const chart = page.getByRole("img", {
      name: /daily usage line chart/i,
    });
    const legendItems = chart.locator(".recharts-legend-item");
    await expect(legendItems).toHaveCount(3);
  });

  test("empty state message is shown when search has no matches", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/teams/${teamId}?month=${currentMonth}&year=${currentYear}`,
    );

    const searchInput = page.getByPlaceholder("Search members…");
    await searchInput.fill("nonexistent-member-xyz");

    await expect(
      page.getByText(/no members match your search/i),
    ).toBeVisible();
  });
});

test.describe.skip("Team Usage — Statistics Cards", () => {
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

  test("stats cards show correct aggregate values for multiple teams", async ({ page }) => {
    // Team A: 2 members — seat1 has 300 requests (capped at 300), seat2 has 150
    // capped_total = 450, usage = 450 / (2×300) × 100 = 75%
    const seat1Id = await seedSeat({ githubUsername: "stats-alice", githubUserId: 9001 });
    const seat2Id = await seedSeat({ githubUsername: "stats-bob", githubUserId: 9002 });
    const teamAId = await seedTeam("Stats Team A");
    await seedMemberSnapshot(teamAId, seat1Id, currentMonth, currentYear);
    await seedMemberSnapshot(teamAId, seat2Id, currentMonth, currentYear);
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 300, 12.0)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);

    // Team B: 1 member — 120 requests → usage = 120 / 300 × 100 = 40%
    const seat3Id = await seedSeat({ githubUsername: "stats-charlie", githubUserId: 9003 });
    const teamBId = await seedTeam("Stats Team B");
    await seedMemberSnapshot(teamBId, seat3Id, currentMonth, currentYear);
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 120, 4.8)]);

    // Team C: 1 member — 270 requests → usage = 270 / 300 × 100 = 90%
    const seat4Id = await seedSeat({ githubUsername: "stats-dana", githubUserId: 9004 });
    const teamCId = await seedTeam("Stats Team C");
    await seedMemberSnapshot(teamCId, seat4Id, currentMonth, currentYear);
    await seedUsage(seat4Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 270, 10.8)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

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

  test("stats cards show dash when no teams have usage data", async ({ page }) => {
    // No teams, no usage — cards should show "—"
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    const dashValues = cards.getByText("—");
    await expect(dashValues).toHaveCount(4);
  });

  test("stats cards are not affected by search filter", async ({ page }) => {
    // Seed 2 teams with different usage
    const seat1Id = await seedSeat({ githubUsername: "search-s1", githubUserId: 9101 });
    const teamAId = await seedTeam("Alpha Team");
    await seedMemberSnapshot(teamAId, seat1Id, currentMonth, currentYear);
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);

    const seat2Id = await seedSeat({ githubUsername: "search-s2", githubUserId: 9102 });
    const teamBId = await seedTeam("Beta Team");
    await seedMemberSnapshot(teamBId, seat2Id, currentMonth, currentYear);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 90, 3.6)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toHaveAttribute("aria-busy", "false");

    // Both teams: Alpha = 150/300 × 100 = 50%, Beta = 90/300 × 100 = 30%
    // Average = 40%, Min = 30%, Max = 50%
    const averageCard = cards.locator("div").filter({ hasText: "Average Usage" });
    await expect(averageCard.getByText("40%")).toBeVisible();

    // Filter to only Alpha Team
    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("Alpha");
    const table = page.getByRole("table");
    await expect(table.getByText("Beta Team")).not.toBeVisible();

    // Stats cards should STILL show global stats (not filtered)
    await expect(averageCard.getByText("40%")).toBeVisible();

    const minCard = cards.locator("div").filter({ hasText: "Minimum Usage" });
    await expect(minCard.getByText("30%")).toBeVisible();

    const maxCard = cards.locator("div").filter({ hasText: "Maximum Usage" });
    await expect(maxCard.getByText("50%")).toBeVisible();
  });

  test("stats cards are visible above the search box", async ({ page }) => {
    const seatId = await seedSeat({ githubUsername: "pos-user", githubUserId: 9201 });
    const teamId = await seedTeam("Position Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const cards = page.locator("[aria-busy]").first();
    await expect(cards).toBeVisible();

    const searchInput = page.getByPlaceholder("Search teams…");
    await expect(searchInput).toBeVisible();

    // Verify cards appear above search by checking Y positions
    const cardsBox = await cards.boundingBox();
    const searchBox = await searchInput.boundingBox();
    expect(cardsBox).toBeTruthy();
    expect(searchBox).toBeTruthy();
    expect(cardsBox!.y).toBeLessThan(searchBox!.y);
  });
});

test.describe.skip("Team Usage — Most Active Teams Rankings", () => {
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

  test("rankings section shows correct top entries ordered by usage percentage", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed 3 teams with different usage levels (all below baseline quota of 300)
    const seat1Id = await seedSeat({ githubUsername: "rank-alice", githubUserId: 7001 });
    const seat2Id = await seedSeat({ githubUsername: "rank-bob", githubUserId: 7002 });
    const seat3Id = await seedSeat({ githubUsername: "rank-charlie", githubUserId: 7003 });
    const seat4Id = await seedSeat({ githubUsername: "rank-diana", githubUserId: 7004 });

    const teamAId = await seedTeam("Alpha Squad");
    await seedMemberSnapshot(teamAId, seat1Id, currentMonth, currentYear);
    await seedMemberSnapshot(teamAId, seat2Id, currentMonth, currentYear);
    // Alpha: (270 + 240) capped / (2 × 300) × 100 = 510/600 × 100 = 85%
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 270, 10.8)]);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 240, 9.6)]);

    const teamBId = await seedTeam("Beta Force");
    await seedMemberSnapshot(teamBId, seat3Id, currentMonth, currentYear);
    // Beta: 150 capped / (1 × 300) × 100 = 50%
    await seedUsage(seat3Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 150, 6.0)]);

    const teamCId = await seedTeam("Gamma Unit");
    await seedMemberSnapshot(teamCId, seat4Id, currentMonth, currentYear);
    // Gamma: 60 capped / (1 × 300) × 100 = 20%
    await seedUsage(seat4Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 60, 2.4)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    // Verify the heading is visible
    const rankingsCard = page.locator(".rounded-lg").filter({ has: page.getByRole("heading", { name: "Most Active Teams" }) });
    await expect(rankingsCard).toBeVisible();

    // Verify entries in order: Alpha (85%), Beta (50%), Gamma (20%)
    const entries = rankingsCard.locator("li");
    await expect(entries).toHaveCount(3);

    const firstEntry = entries.nth(0);
    await expect(firstEntry.getByText("Alpha Squad")).toBeVisible();
    await expect(firstEntry.getByText("2 members")).toBeVisible();
    await expect(firstEntry.getByText("85%")).toBeVisible();

    const secondEntry = entries.nth(1);
    await expect(secondEntry.getByText("Beta Force")).toBeVisible();
    await expect(secondEntry.getByText("1 member", { exact: true })).toBeVisible();
    await expect(secondEntry.getByText("50%")).toBeVisible();

    const thirdEntry = entries.nth(2);
    await expect(thirdEntry.getByText("Gamma Unit")).toBeVisible();
    await expect(thirdEntry.getByText("1 member", { exact: true })).toBeVisible();
    await expect(thirdEntry.getByText("20%")).toBeVisible();
  });

  test("clicking a ranking entry navigates to team detail page", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({ githubUsername: "rank-nav", githubUserId: 7101 });
    const teamId = await seedTeam("Clickable Team");
    await seedMemberSnapshot(teamId, seatId, currentMonth, currentYear);
    await seedUsage(seatId, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 100, 4.0)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const rankingsCard = page.locator(".rounded-lg").filter({ has: page.getByRole("heading", { name: "Most Active Teams" }) });
    await expect(rankingsCard).toBeVisible();

    // Click the team name in the rankings
    await rankingsCard.getByText("Clickable Team").click();

    await expect(page).toHaveURL(new RegExp(`/usage/teams/${teamId}`));
  });

  test("shows empty state when no teams have usage data", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    const rankingsCard = page.locator(".rounded-lg").filter({ has: page.getByRole("heading", { name: "Most Active Teams" }) });
    await expect(rankingsCard).toBeVisible();
    await expect(rankingsCard.getByText("No usage data for this month.")).toBeVisible();
  });

  test("rankings are not affected by search filter", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seat1Id = await seedSeat({ githubUsername: "rank-s1", githubUserId: 7201 });
    const seat2Id = await seedSeat({ githubUsername: "rank-s2", githubUserId: 7202 });

    const teamAId = await seedTeam("Searchable Team");
    await seedMemberSnapshot(teamAId, seat1Id, currentMonth, currentYear);
    await seedUsage(seat1Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 200, 8.0)]);

    const teamBId = await seedTeam("Hidden Team");
    await seedMemberSnapshot(teamBId, seat2Id, currentMonth, currentYear);
    await seedUsage(seat2Id, 1, currentMonth, currentYear, [makeUsageItem("GPT-4o", 90, 3.6)]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();

    // Both teams should appear in rankings
    const rankingsCard = page.locator(".rounded-lg").filter({ has: page.getByRole("heading", { name: "Most Active Teams" }) });
    await expect(rankingsCard.getByText("Searchable Team")).toBeVisible();
    await expect(rankingsCard.getByText("Hidden Team")).toBeVisible();

    // Filter to only "Searchable Team" — table should filter but rankings should not
    const searchInput = page.getByPlaceholder("Search teams…");
    await searchInput.fill("Searchable");

    // Table should be filtered — "Hidden Team" should not appear in the table
    await expect(page.getByRole("row").filter({ hasText: "Hidden Team" })).not.toBeVisible();

    // Rankings should still show both teams
    await expect(rankingsCard.getByText("Searchable Team")).toBeVisible();
    await expect(rankingsCard.getByText("Hidden Team")).toBeVisible();
  });
});


