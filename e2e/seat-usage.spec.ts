import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function seedConfiguration() {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey") VALUES ($1, $2, 'GLOBAL')
     ON CONFLICT ("singletonKey") DO NOTHING`,
    ["organisation", "TestOrg"],
  );
  await client.end();
}

interface SeedSeatOptions {
  githubUsername: string;
  githubUserId: number;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
}

async function seedSeat(options: SeedSeatOptions): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "department")
     VALUES ($1, $2, 'active', $3, $4, $5)
     ON CONFLICT ("githubUsername") DO UPDATE SET "firstName" = EXCLUDED."firstName"
     RETURNING id`,
    [
      options.githubUsername,
      options.githubUserId,
      options.firstName ?? null,
      options.lastName ?? null,
      options.department ?? null,
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

function makeUsageItem(model: string, grossQuantity: number, grossAmount: number, netAmount = 0) {
  return {
    product: "Copilot",
    sku: "Premium",
    model,
    unitType: "requests",
    pricePerUnit: 0.04,
    grossQuantity,
    grossAmount,
    discountQuantity: grossQuantity - Math.round(grossAmount > netAmount ? grossQuantity * ((grossAmount - netAmount) / grossAmount) : 0),
    discountAmount: grossAmount - netAmount,
    netQuantity: Math.round(netAmount / 0.04),
    netAmount,
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

test.describe("Usage Analytics — Seat Tab", () => {
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

  test("Usage link is visible in navigation and navigates to /usage", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    const usageLink = page.getByRole("link", { name: "Usage" });
    await expect(usageLink).toBeVisible();
    await usageLink.click();

    await expect(page).toHaveURL(/\/usage(\?|$)/);
  });

  test("Seat tab is active by default", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTab = page.getByRole("tab", { name: "Seat" });
    await expect(seatTab).toBeVisible();
    await expect(seatTab).toHaveAttribute("aria-selected", "true");

    const teamTab = page.getByRole("tab", { name: "Team" });
    await expect(teamTab).toHaveAttribute("aria-selected", "false");

    const departmentTab = page.getByRole("tab", { name: "Department" });
    await expect(departmentTab).toHaveAttribute("aria-selected", "false");
  });

  test("per-seat usage data is displayed in a table", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "alice-dev",
      githubUserId: 2001,
      firstName: "Alice",
      lastName: "Smith",
      department: "Engineering",
    });

    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("Claude Sonnet 4.5", 80, 3.20, 0),
      makeUsageItem("GPT-4o", 20, 0.80, 0.30),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Wait for table to load
    const seatTable = page.locator("table");
    await expect(seatTable.getByText("alice-dev")).toBeVisible();
    await expect(seatTable.getByText("Alice Smith")).toBeVisible();
    await expect(page.getByText("Engineering")).toBeVisible();
    await expect(page.getByText("$4.00")).toBeVisible(); // gross: 3.20 + 0.80 (Total Spending)

    // Verify AIC-specific columns are present.
    await expect(page.getByRole("columnheader", { name: "AIC Units" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Total Spending" })).toBeVisible();

    const aliceRow = page.locator("tr", { hasText: "alice-dev" });
    await expect(aliceRow.getByText("100")).toBeVisible();
    await expect(aliceRow.getByText("$4.00")).toBeVisible();

    // Models and Net Amount are not shown in the AIC table.
    await expect(page.getByRole("columnheader", { name: "Models" })).not.toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Net Amount" })).not.toBeVisible();
  });

  test("clicking a seat row navigates to the seat detail page", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "bob-dev",
      githubUserId: 2002,
      firstName: "Bob",
      lastName: "Jones",
      department: "Design",
    });

    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("Claude Sonnet 4.5", 50, 2.00),
      makeUsageItem("Claude Haiku 4.5", 30, 1.20),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Click on the seat row
    await page.locator("table").getByRole("link", { name: "bob-dev" }).click();

    await expect(page).toHaveURL(new RegExp(`/usage/seats/${seatId}\\?month=${currentMonth}&year=${currentYear}`));
  });

  test("empty state is shown when no usage data exists for the selected month", async ({
    page,
  }) => {
    // Seed a dashboard summary so the months API returns data, but no usage data
    await seedDashboardSummary(currentMonth, currentYear);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    await expectCostCards(page, {
      averageDailyCost: "$0.00",
      totalCost: "$0.00",
      predictedMonthCost: "$0.00",
    });
    await expect(
      page.getByText(/no per-seat usage data available/i),
    ).toBeVisible();
  });

  test("month filter changes displayed data", async ({ page }) => {
    // Seed data for two months — current and previous
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedDashboardSummary(currentMonth, currentYear);
    await seedDashboardSummary(prevMonth, prevYear);

    // Current month seat
    const seatId1 = await seedSeat({
      githubUsername: "current-user",
      githubUserId: 3001,
      firstName: "Current",
      lastName: "Dev",
    });
    await seedUsage(seatId1, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.00),
    ]);

    // Previous month seat
    const seatId2 = await seedSeat({
      githubUsername: "prev-user",
      githubUserId: 3002,
      firstName: "Prev",
      lastName: "Dev",
    });
    await seedUsage(seatId2, 1, prevMonth, prevYear, [
      makeUsageItem("Claude Sonnet 4.5", 60, 2.40),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Current month data should be visible
    const seatTable = page.locator("table");
    await expect(seatTable.getByText("current-user")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Average Daily Cost" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Total Cost" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Predicted Month Cost" })).toBeVisible();

    // Switch to previous month
    const select = page.getByLabel("Month");
    await expect(select).toBeVisible();
    await select.selectOption(`${prevMonth}-${prevYear}`);

    // Previous month data should now be visible
    await expect(seatTable.getByText("prev-user")).toBeVisible();
    await expect(page.getByText("$2.40")).toBeVisible(); // gross amount for prev-user
    await expect(page.getByRole("heading", { name: "Average Daily Cost" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Total Cost" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Predicted Month Cost" })).toBeVisible();
  });

  test("pagination controls are visible and functional when data exceeds page size", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed 25 seats with usage — exceeds default page size of 20
    for (let i = 1; i <= 25; i++) {
      const seatId = await seedSeat({
        githubUsername: `paginated-user-${String(i).padStart(2, "0")}`,
        githubUserId: 4000 + i,
        firstName: `User`,
        lastName: `${i}`,
      });
      await seedUsage(seatId, 1, currentMonth, currentYear, [
        makeUsageItem("GPT-4o", i * 10, i * 0.40),
      ]);
    }

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Wait for table data
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expectCostCards(page, expectedCostCards(3250, currentMonth, currentYear));

    // Navigate to page 2
    const nextButton = page.getByRole("button", { name: /next page/i });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expectCostCards(page, expectedCostCards(3250, currentMonth, currentYear));

    // Previous button should be enabled, Next should be disabled
    const prevButton = page.getByRole("button", { name: /previous page/i });
    await expect(prevButton).toBeEnabled();
    await expect(nextButton).toBeDisabled();

    // Navigate back to page 1
    await prevButton.click();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();

    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("paginated-user-01");
    const seatTable = page.locator("table");
    await expect(seatTable.getByText("paginated-user-01")).toBeVisible();
    await expectCostCards(page, expectedCostCards(3250, currentMonth, currentYear));
  });

  test("seat cost cards remain visible in an AIC reporting month", async ({ page }) => {
    const aicMonth = 5;
    const aicYear = 2026;

    await seedDashboardSummary(currentMonth, currentYear);
    await seedDashboardSummary(aicMonth, aicYear);
    const seatId = await seedSeat({
      githubUsername: "aic-seat-user",
      githubUserId: 4501,
    });
    await seedUsage(seatId, 1, aicMonth, aicYear, [
      makeUsageItem("GPT-4o", 500, 20),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const select = page.getByLabel("Month");
    await select.selectOption(`${aicMonth}-${aicYear}`);

    await expect(page.getByRole("columnheader", { name: "AIC Units" })).toBeVisible();
    await expectCostCards(page, expectedCostCards(500, aicMonth, aicYear));
  });

  test("Team and Department tabs show content", async ({
    page,
  }) => {
    await seedDashboardSummary(currentMonth, currentYear);
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Click Team tab — should show either teams panel or "No teams" message (not placeholder)
    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();
    await expect(teamTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText(/no teams have been defined yet/i),
    ).toBeVisible();

    // Click Department tab — should show departments panel or "No departments" message
    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();
    await expect(deptTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText(/no departments have been defined yet/i),
    ).toBeVisible();
  });
});

test.describe("Usage Analytics — Seat Search", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    await seedDashboardSummary(currentMonth, currentYear);

    // Seed three distinct seats for search testing
    const aliceId = await seedSeat({
      githubUsername: "alice-dev",
      githubUserId: 6001,
      firstName: "Alice",
      lastName: "Smith",
    });
    await seedUsage(aliceId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 50, 2.00),
    ]);

    const bobId = await seedSeat({
      githubUsername: "bob-eng",
      githubUserId: 6002,
      firstName: "Bob",
      lastName: "Johnson",
    });
    await seedUsage(bobId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 30, 1.20),
    ]);

    const charlieId = await seedSeat({
      githubUsername: "charlie-ops",
      githubUserId: 6003,
      firstName: "Charlie",
      lastName: "Brown",
    });
    await seedUsage(charlieId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 20, 0.80),
    ]);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("search input is visible on the seat usage tab", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const searchInput = page.getByPlaceholder("Search seats…");
    await expect(searchInput).toBeVisible();
  });

  test("typing a query filters the seat table to matching results", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTable = page.locator("table");

    // All 3 seats visible initially
    await expect(seatTable.getByText("alice-dev")).toBeVisible();

    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("alice");

    // After debounce, only Alice's seat should appear
    await expect(seatTable.getByText("alice-dev")).toBeVisible();
    await expect(seatTable.getByText("bob-eng")).not.toBeVisible();
    await expect(seatTable.getByText("charlie-ops")).not.toBeVisible();
  });

  test("search is case-insensitive", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTable = page.locator("table");
    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("ALICE");

    await expect(seatTable.getByText("alice-dev")).toBeVisible();
    await expect(seatTable.getByText("bob-eng")).not.toBeVisible();
  });

  test("clearing the search input restores the full list", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTable = page.locator("table");
    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("alice");
    await expect(seatTable.getByText("bob-eng")).not.toBeVisible();

    // Clear the search
    await searchInput.clear();

    // All seats should reappear
    await expect(seatTable.getByText("alice-dev")).toBeVisible();
    await expect(seatTable.getByText("bob-eng")).toBeVisible();
    await expect(seatTable.getByText("charlie-ops")).toBeVisible();
  });

  test("empty state message is shown when search has no matches", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("nonexistent-user-xyz");

    await expect(page.getByText(/no seats match your search/i)).toBeVisible();
  });

  test("pagination resets to page 1 when a search query is entered", async ({ page }) => {
    // Seed additional seats to ensure pagination
    for (let i = 10; i <= 30; i++) {
      const seatId = await seedSeat({
        githubUsername: `extra-user-${i}`,
        githubUserId: 7000 + i,
        firstName: "Extra",
        lastName: `User${i}`,
      });
      await seedUsage(seatId, 1, currentMonth, currentYear, [
        makeUsageItem("GPT-4o", i * 5, i * 0.20),
      ]);
    }

    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    // Navigate to page 2
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("button", { name: /next page/i }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    // Search should reset to page 1
    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("alice");
    await expect(page.locator("table").getByText("alice-dev")).toBeVisible();
    // Should no longer show page 2
    await expect(page.getByText(/Page 2/)).not.toBeVisible();
  });

  test("search query is preserved in URL after page refresh", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const seatTable = page.locator("table");
    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("bob");

    // Wait for results to filter
    await expect(seatTable.getByText("bob-eng")).toBeVisible();
    await expect(seatTable.getByText("alice-dev")).not.toBeVisible();

    // URL should contain search param
    await expect(page).toHaveURL(/search=bob/);

    // Refresh the page
    await page.reload();

    // After reload, search should be pre-filled and results filtered
    const reloadedSearchInput = page.getByPlaceholder("Search seats…");
    await expect(reloadedSearchInput).toHaveValue("bob");
    await expect(seatTable.getByText("bob-eng")).toBeVisible();
    await expect(seatTable.getByText("alice-dev")).not.toBeVisible();
  });

  test("switching tabs clears the search param from URL", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/usage");

    const searchInput = page.getByPlaceholder("Search seats…");
    await searchInput.fill("alice");

    // Wait for filtered results
    await expect(page.locator("table").getByText("alice-dev")).toBeVisible();
    await expect(page).toHaveURL(/search=alice/);

    // Switch to Team tab
    const teamTab = page.getByRole("tab", { name: "Team" });
    await teamTab.click();
    await expect(teamTab).toHaveAttribute("aria-selected", "true");

    // URL should no longer contain search param
    await expect(page).not.toHaveURL(/search=/);
  });
});

test.describe("Seat Detail — Drill-Down", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  const currentMonthName = MONTH_NAMES[currentMonth - 1];

  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("breadcrumb navigates back to /usage with seat tab active", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "detail-user",
      githubUserId: 5001,
      firstName: "Detail",
      lastName: "User",
    });

    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.00, 1.00),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    // Verify the detail page loaded
    await expect(page.getByRole("heading", { name: "detail-user" })).toBeVisible();

    // Breadcrumb should render
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText("Usage")).toBeVisible();
    await expect(breadcrumb.getByText("Seats")).toBeVisible();
    await expect(breadcrumb.getByText("detail-user")).toBeVisible();

    // Click breadcrumb "Usage" link
    await breadcrumb.getByRole("link", { name: "Usage" }).click();

    await expect(page).toHaveURL(/\/usage\?/);
    await expect(page).toHaveURL(/tab=seat/);

    // Verify Seat tab is active
    const seatTab = page.getByRole("tab", { name: "Seat" });
    await expect(seatTab).toHaveAttribute("aria-selected", "true");
  });

  test("summary cards display cost cards", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "summary-user",
      githubUserId: 5002,
      firstName: "Summary",
      lastName: "User",
    });

    // Seed usage across two days with known netAmount values
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 60, 2.40, 0.80),
      makeUsageItem("Claude Sonnet 4.5", 40, 1.60, 0.50),
    ]);
    await seedUsage(seatId, 2, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 50, 2.00, 0.70),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expectCostCards(page, expectedCostCards(150, currentMonth, currentYear));
  });

  test("daily usage chart is visible", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "chart-user",
      githubUserId: 5003,
    });

    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.00),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    // Chart container should be rendered with role="img"
    const chart = page.getByRole("img", { name: /daily usage/i });
    await expect(chart).toBeVisible();
  });

  test("model breakdown table displays per-model data", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "model-user",
      githubUserId: 5004,
    });

    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("Claude Sonnet 4.5", 80, 3.20, 0.40),
      makeUsageItem("GPT-4o", 20, 0.80, 0.30),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    // Model breakdown should be visible
    await expect(page.getByText("Model Breakdown")).toBeVisible();
    await expect(page.getByText("Claude Sonnet 4.5")).toBeVisible();
    await expect(page.getByText("GPT-4o")).toBeVisible();
  });

  test("month filter changes the displayed data", async ({ page }) => {
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await seedDashboardSummary(currentMonth, currentYear);
    await seedDashboardSummary(prevMonth, prevYear);

    const seatId = await seedSeat({
      githubUsername: "filter-user",
      githubUserId: 5005,
      firstName: "Filter",
      lastName: "User",
    });

    // Current month: 100 requests
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 100, 4.00, 1.20),
    ]);

    // Previous month: 50 requests
    await seedUsage(seatId, 1, prevMonth, prevYear, [
      makeUsageItem("GPT-4o", 50, 2.00, 0.60),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expectCostCards(page, expectedCostCards(100, currentMonth, currentYear));

    // Switch to previous month
    const select = page.getByLabel("Month");
    await expect(select).toBeVisible();
    await select.selectOption(`${prevMonth}-${prevYear}`);

    await expectCostCards(page, expectedCostCards(50, prevMonth, prevYear));
  });

  test("empty state is shown when seat has no usage data for the selected month", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "empty-user",
      githubUserId: 5006,
      firstName: "Empty",
      lastName: "User",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expect(page.getByText(/no aic csv data available/i)).toBeVisible();
  });

  test("seat detail page shows cost cards without a progress bar", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "bar-user",
      githubUserId: 5010,
      firstName: "Bar",
      lastName: "User",
    });

    // 150 AIC units should be shown directly
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.00, 2.00),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expectCostCards(page, expectedCostCards(150, currentMonth, currentYear));
  });

  test("seat detail page shows zero AIC totals when seat has no usage data", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "zero-bar-user",
      githubUserId: 5011,
      firstName: "Zero",
      lastName: "Bar",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expect(page.getByText(/no aic csv data available/i)).toBeVisible();
  });

  test("seat detail page shows uncapped cost cards when usage exceeds the legacy baseline", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "overcap-user",
      githubUserId: 5012,
      firstName: "Over",
      lastName: "Cap",
    });

    // 500 AIC units should be shown directly
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 500, 20.00, 5.00),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expectCostCards(page, expectedCostCards(500, currentMonth, currentYear));
  });

  test("model name link navigates to seat model daily detail preserving scope", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "model-link-user",
      githubUserId: 5013,
      firstName: "Model",
      lastName: "Link",
    });

    const selectedModel = "Model Alpha / 50%";
    await seedUsage(seatId, 10, currentMonth, currentYear, [
      makeUsageItem(selectedModel, 42, 1.68, 0.4),
      makeUsageItem("Other Model", 100, 4.0, 1.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(`/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`);

    await expect(page.getByRole("heading", { name: "Model Breakdown" })).toBeVisible();

    const selectedModelLink = page.getByRole("link", { name: selectedModel });
    await expect(selectedModelLink).toBeVisible();
    await selectedModelLink.click();

    await expect(page).toHaveURL(
      `/usage/seats/${seatId}/models/${encodeURIComponent(selectedModel)}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `Daily AIC Units for ${selectedModel} by model-link-user (${currentMonthName} ${currentYear})`,
      }),
    ).toBeVisible();

    await expect(
      page.getByRole("img", {
        name: /daily usage bar chart showing aic units per day/i,
      }),
    ).toBeVisible();

    const backLink = page.getByRole("link", { name: /back to model-link-user/i });
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL(
      `/usage/seats/${seatId}?month=${currentMonth}&year=${currentYear}`,
    );
  });

  test("seat model daily detail excludes other model usage on the same date", async ({ page }) => {
    await seedDashboardSummary(currentMonth, currentYear);

    const seatId = await seedSeat({
      githubUsername: "model-filter-user",
      githubUserId: 5014,
      firstName: "Model",
      lastName: "Filter",
    });

    await seedUsage(seatId, 12, currentMonth, currentYear, [
      makeUsageItem("Claude Sonnet 4.5", 77, 3.08, 1.0),
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatId}/models/${encodeURIComponent("GPT-4o")}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", {
        name: `Daily AIC Units for GPT-4o by model-filter-user (${currentMonthName} ${currentYear})`,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("No AIC CSV data for this model and time period."),
    ).toBeVisible();
  });
});
