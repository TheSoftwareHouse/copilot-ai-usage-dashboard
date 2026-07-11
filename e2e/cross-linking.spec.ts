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
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM team_member_snapshot");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM team");
  await client.query("DELETE FROM department");
  await client.query("DELETE FROM dashboard_monthly_summary");
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

async function seedDepartment(name: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO department (name) VALUES ($1) RETURNING id`,
    [name]
  );
  await client.end();
  return result.rows[0].id;
}

async function seedSeat(githubUsername: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status")
     VALUES ($1, $2, 'active')
     ON CONFLICT ("githubUsername") DO UPDATE SET status = 'active'
     RETURNING id`,
    [githubUsername, Math.floor(Math.random() * 1_000_000)]
  );
  await client.end();
  return result.rows[0].id;
}

async function seedSeatWithDepartment(
  githubUsername: string,
  departmentName: string,
  departmentId: number,
): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "department", "departmentId")
     VALUES ($1, $2, 'active', $3, $4)
     ON CONFLICT ("githubUsername") DO UPDATE SET "department" = EXCLUDED."department", "departmentId" = EXCLUDED."departmentId"
     RETURNING id`,
    [githubUsername, Math.floor(Math.random() * 1_000_000), departmentName, departmentId],
  );
  await client.end();
  return result.rows[0].id;
}

async function seedTeamMemberSnapshot(
  teamId: number,
  seatId: number,
  month: number,
  year: number,
): Promise<void> {
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
): Promise<void> {
  const usageItems = [
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
  ];
  const client = await getClient();
  await client.query(
    `INSERT INTO copilot_usage ("seatId", "day", "month", "year", "usageItems")
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [seatId, day, month, year, JSON.stringify(usageItems)],
  );
  await client.end();
}

async function seedDashboardSummary(
  month: number,
  year: number,
): Promise<void> {
  const client = await getClient();
  await client.query(
    `INSERT INTO dashboard_monthly_summary ("month", "year", "totalSeats", "activeSeats", "totalSpending", "seatBaseCost", "totalAiCredits", "modelUsage", "mostActiveUsers", "leastActiveUsers")
     VALUES ($1, $2, 10, 8, 500, 300, 1000, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
     ON CONFLICT ON CONSTRAINT "UQ_dashboard_monthly_summary_month_year" DO NOTHING`,
    [month, year],
  );
  await client.end();
}

test.describe("Cross-linking from management to usage pages", () => {
  let teamId: number;
  let departmentId: number;
  let seatId: number;

  test.beforeAll(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
    teamId = await seedTeam("CrossLink Team");
    departmentId = await seedDepartment("CrossLink Dept");
    seatId = await seedSeat("crosslink-user");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("team name in management links to team usage page", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    // Team name is now an inline-editable cell; navigate via the → link in the same row
    const row = page.locator("table").getByRole("row").filter({ hasText: "CrossLink Team" });
    const navLink = row.getByRole("link", { name: /view team usage/i });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await page.waitForURL(`**/usage/teams/${teamId}**`, { timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/usage/teams/${teamId}`));
  });

  test("department name in management links to department usage page", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Department name is now an inline-editable cell; navigate via the → link in the same row
    const row = page.locator("table").getByRole("row").filter({ hasText: "CrossLink Dept" });
    const navLink = row.getByRole("link", { name: /view department usage/i });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await page.waitForURL(`**/usage/departments/${departmentId}**`, {
      timeout: 10000,
    });
    await expect(page).toHaveURL(
      new RegExp(`/usage/departments/${departmentId}`)
    );
  });

  test("seat username in management links to seat usage page", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const seatLink = page.getByRole("link", { name: "crosslink-user" });
    await expect(seatLink).toBeVisible();
    await seatLink.click();

    await page.waitForURL(`**/usage/seats/${seatId}**`, { timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/usage/seats/${seatId}`));
  });
});

test.describe("Cross-linking from seat detail to team/department usage", () => {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  let teamId: number;
  let departmentId: number;
  let seatWithBothId: number;
  let seatNoDeptId: number;
  let seatNoTeamId: number;

  test.beforeAll(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");

    departmentId = await seedDepartment("SeatDetail Dept");
    teamId = await seedTeam("SeatDetail Team");

    seatWithBothId = await seedSeatWithDepartment(
      "seatdetail-both-user",
      "SeatDetail Dept",
      departmentId,
    );
    await seedTeamMemberSnapshot(teamId, seatWithBothId, currentMonth, currentYear);
    await seedUsage(seatWithBothId, 1, currentMonth, currentYear);

    seatNoDeptId = await seedSeat("seatdetail-nodept-user");
    await seedUsage(seatNoDeptId, 1, currentMonth, currentYear);

    seatNoTeamId = await seedSeatWithDepartment(
      "seatdetail-noteam-user",
      "SeatDetail Dept",
      departmentId,
    );
    await seedUsage(seatNoTeamId, 1, currentMonth, currentYear);

    await seedDashboardSummary(currentMonth, currentYear);
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("should show department link that navigates to department usage", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatWithBothId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "seatdetail-both-user" }),
    ).toBeVisible();

    const deptLink = page.getByRole("link", { name: "SeatDetail Dept" });
    await expect(deptLink).toBeVisible();
    await deptLink.click();

    await page.waitForURL(`**/usage/departments/${departmentId}**`, {
      timeout: 10000,
    });
    await expect(page).toHaveURL(
      new RegExp(
        `/usage/departments/${departmentId}\\?month=${currentMonth}&year=${currentYear}`,
      ),
    );
  });

  test("should show team link that navigates to team usage", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatWithBothId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "seatdetail-both-user" }),
    ).toBeVisible();

    const teamLink = page.getByRole("link", { name: "SeatDetail Team" });
    await expect(teamLink).toBeVisible();
    await teamLink.click();

    await page.waitForURL(`**/usage/teams/${teamId}**`, { timeout: 10000 });
    await expect(page).toHaveURL(
      new RegExp(
        `/usage/teams/${teamId}\\?month=${currentMonth}&year=${currentYear}`,
      ),
    );
  });

  test("should show no department link when seat has no department", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatNoDeptId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "seatdetail-nodept-user" }),
    ).toBeVisible();

    await expect(page.getByText("Department:")).not.toBeVisible();
  });

  test("should show no team links when seat has no team memberships", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto(
      `/usage/seats/${seatNoTeamId}?month=${currentMonth}&year=${currentYear}`,
    );

    await expect(
      page.getByRole("heading", { name: "seatdetail-noteam-user" }),
    ).toBeVisible();

    await expect(page.getByText("Teams:")).not.toBeVisible();
  });
});
