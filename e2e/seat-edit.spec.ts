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

async function seedDepartment(name: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO department (name) VALUES ($1)
     ON CONFLICT ("name") DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name]
  );
  await client.end();
  return result.rows[0].id;
}

interface SeedSeatOptions {
  githubUsername: string;
  githubUserId: number;
  status?: "active" | "inactive";
  firstName?: string | null;
  lastName?: string | null;
  departmentId?: number | null;
  lastActivityAt?: string | null;
}

async function seedSeat(options: SeedSeatOptions): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status", "firstName", "lastName", "departmentId", "lastActivityAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("githubUsername") DO UPDATE SET
       "firstName" = EXCLUDED."firstName",
       "lastName" = EXCLUDED."lastName",
       "departmentId" = EXCLUDED."departmentId"
     RETURNING id`,
    [
      options.githubUsername,
      options.githubUserId,
      options.status ?? "active",
      options.firstName ?? null,
      options.lastName ?? null,
      options.departmentId ?? null,
      options.lastActivityAt ?? null,
    ]
  );
  await client.end();
  return result.rows[0].id;
}

async function seedDashboardSummary(month: number, year: number) {
  const client = await getClient();
  await client.query(
    `INSERT INTO dashboard_monthly_summary ("month", "year", "totalSeats", "activeSeats", "totalSpending", "seatBaseCost", "totalAiCredits", "modelUsage", "mostActiveUsers", "leastActiveUsers")
     VALUES ($1, $2, 10, 8, 500, 300, 1000, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
     ON CONFLICT ON CONSTRAINT "UQ_dashboard_monthly_summary_month_year" DO NOTHING`,
    [month, year]
  );
  await client.end();
}

async function seedUsage(
  seatId: number,
  day: number,
  month: number,
  year: number,
  usageItems: unknown[]
) {
  const client = await getClient();
  await client.query(
    `INSERT INTO copilot_usage ("seatId", "day", "month", "year", "usageItems")
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [seatId, day, month, year, JSON.stringify(usageItems)]
  );
  await client.end();
}

function makeUsageItem(
  model: string,
  grossQuantity: number,
  grossAmount: number
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

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM department");
  await client.query("DELETE FROM dashboard_monthly_summary");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Seat Inline Edit", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("clicking on a first name cell activates inline text input", async ({
    page,
  }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Click the first name cell text
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();

    // An input should appear with the current value
    const input = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("Octo");
    await expect(input).toBeFocused();
  });

  test("pressing Enter saves the first name and exits edit mode", async ({
    page,
  }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Activate inline edit
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();

    const input = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await input.clear();
    await input.fill("Updated");
    await input.press("Enter");

    // Input should disappear, new value should show
    await expect(input).not.toBeVisible();
    await expect(octocatRow.getByText("Updated")).toBeVisible();
  });

  test("pressing Escape reverts the first name without saving", async ({
    page,
  }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Activate inline edit
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();

    const input = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await input.clear();
    await input.fill("Changed");
    await input.press("Escape");

    // Input should disappear, original value should remain
    await expect(input).not.toBeVisible();
    await expect(
      octocatRow.getByRole("button", { name: /Edit first name/i })
    ).toHaveText("Octo");
  });

  test("clicking outside the input saves the new value", async ({ page }) => {
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Activate inline edit on first name
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();

    const input = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await input.clear();
    await input.fill("BlurSave");

    // Click elsewhere to trigger blur
    await page.locator("h1").click();

    // Verify the new value is displayed
    await expect(input).not.toBeVisible();
    await expect(octocatRow.getByText("BlurSave")).toBeVisible();
  });

  test("clicking on department cell activates a dropdown with departments", async ({
    page,
  }) => {
    const engId = await seedDepartment("Engineering");
    await seedDepartment("Product");
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
      departmentId: engId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Click the department cell
    await octocatRow
      .getByRole("button", { name: /Edit department/i })
      .click();

    // A select should appear
    const select = octocatRow.getByRole("combobox", {
      name: /Edit department/i,
    });
    await expect(select).toBeVisible();
    await expect(select).toBeFocused();
    await expect(select).toHaveValue(String(engId));

    // Verify options include departments and "None"
    const options = select.locator("option");
    await expect(options).toHaveCount(3); // None + Engineering + Product
  });

  test("selecting a different department saves immediately", async ({
    page,
  }) => {
    const engId = await seedDepartment("Engineering");
    const prodId = await seedDepartment("Product");
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
      departmentId: engId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Activate department edit
    await octocatRow
      .getByRole("button", { name: /Edit department/i })
      .click();

    const select = octocatRow.getByRole("combobox", {
      name: /Edit department/i,
    });
    await select.selectOption(String(prodId));

    // Select should disappear and new department should show
    await expect(select).not.toBeVisible();
    await expect(octocatRow.getByText("Product")).toBeVisible();
  });

  test("user can update first name, last name, and department via inline editing", async ({
    page,
  }) => {
    const engId = await seedDepartment("Engineering");
    const prodId = await seedDepartment("Product");
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
      departmentId: engId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Edit first name
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();
    const firstInput = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await firstInput.clear();
    await firstInput.fill("Updated");
    await firstInput.press("Enter");
    await expect(firstInput).not.toBeVisible();

    // Edit last name
    await octocatRow
      .getByRole("button", { name: /Edit last name/i })
      .click();
    const lastInput = octocatRow.getByRole("textbox", {
      name: /Edit last name/i,
    });
    await lastInput.clear();
    await lastInput.fill("Name");
    await lastInput.press("Enter");
    await expect(lastInput).not.toBeVisible();

    // Edit department
    await octocatRow
      .getByRole("button", { name: /Edit department/i })
      .click();
    const deptSelect = octocatRow.getByRole("combobox", {
      name: /Edit department/i,
    });
    await deptSelect.selectOption(String(prodId));
    await expect(deptSelect).not.toBeVisible();

    // Verify all values are updated
    await expect(octocatRow.getByText("Updated")).toBeVisible();
    await expect(octocatRow.getByText("Name")).toBeVisible();
    await expect(octocatRow.getByText("Product")).toBeVisible();
  });

  test("clearing a text field saves null — displayed as dash", async ({
    page,
  }) => {
    await seedDepartment("Engineering");
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Clear first name via inline edit
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();
    const input = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await input.clear();
    await input.press("Enter");

    // Verify the field shows "—"
    await expect(input).not.toBeVisible();
    // First name column (3rd td, index 2) should show em dash
    const firstNameCell = octocatRow.locator("td").nth(2);
    await expect(firstNameCell).toHaveText("—");
  });

  test("selecting None in department dropdown clears the department", async ({
    page,
  }) => {
    const engId = await seedDepartment("Engineering");
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
      departmentId: engId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Activate department dropdown
    await octocatRow
      .getByRole("button", { name: /Edit department/i })
      .click();
    const select = octocatRow.getByRole("combobox", {
      name: /Edit department/i,
    });
    await expect(select).toHaveValue(String(engId));

    // Select "None"
    await select.selectOption("");

    // Department column (5th td, index 4) should show "—"
    await expect(select).not.toBeVisible();
    const deptCell = octocatRow.locator("td").nth(4);
    await expect(deptCell).toHaveText("—");
  });

  test("editing does not change GitHub username or status", async ({
    page,
  }) => {
    const engId = await seedDepartment("Engineering");
    const prodId = await seedDepartment("NewDept");
    await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      status: "active",
      firstName: "Octo",
      lastName: "Cat",
      departmentId: engId,
    });

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Update first name inline
    await octocatRow
      .getByRole("button", { name: /Edit first name/i })
      .click();
    const firstInput = octocatRow.getByRole("textbox", {
      name: /Edit first name/i,
    });
    await firstInput.clear();
    await firstInput.fill("NewFirst");
    await firstInput.press("Enter");
    await expect(firstInput).not.toBeVisible();

    // Update last name inline
    await octocatRow
      .getByRole("button", { name: /Edit last name/i })
      .click();
    const lastInput = octocatRow.getByRole("textbox", {
      name: /Edit last name/i,
    });
    await lastInput.clear();
    await lastInput.fill("NewLast");
    await lastInput.press("Enter");
    await expect(lastInput).not.toBeVisible();

    // Update department inline
    await octocatRow
      .getByRole("button", { name: /Edit department/i })
      .click();
    const deptSelect = octocatRow.getByRole("combobox", {
      name: /Edit department/i,
    });
    await deptSelect.selectOption(String(prodId));
    await expect(deptSelect).not.toBeVisible();

    // Verify GitHub username and status are unchanged
    await expect(octocatRow.getByText("octocat")).toBeVisible();
    await expect(octocatRow.getByLabel("Status: Active")).toBeVisible();

    // Verify enrichment fields are updated
    await expect(octocatRow.getByText("NewFirst")).toBeVisible();
    await expect(octocatRow.getByText("NewLast")).toBeVisible();
    await expect(octocatRow.getByText("NewDept")).toBeVisible();
  });

  test("assigning department via inline edit is reflected in the department usage tab", async ({
    page,
  }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    await seedDashboardSummary(currentMonth, currentYear);

    const engId = await seedDepartment("Engineering");
    // Seed seat WITHOUT department assignment and with usage data
    const seatId = await seedSeat({
      githubUsername: "octocat",
      githubUserId: 1,
      firstName: "Octo",
      lastName: "Cat",
    });
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      makeUsageItem("GPT-4o", 150, 6.0),
    ]);

    await loginViaApi(page, "admin", "password123");

    // Step 1: Assign department via inline department edit
    await page.goto("/management?tab=seats");
    const table = page.locator("table");
    await expect(table).toBeVisible();

    const octocatRow = table.locator("tr", { hasText: "octocat" });

    // Click department cell (currently "—") to activate edit
    await octocatRow
      .getByRole("button", { name: /Edit department/i })
      .click();
    const select = octocatRow.getByRole("combobox", {
      name: /Edit department/i,
    });
    await select.selectOption(String(engId));

    // Verify department is now shown
    await expect(select).not.toBeVisible();
    await expect(octocatRow.getByText("Engineering")).toBeVisible();

    // Step 2: Navigate to department usage tab and verify
    await page.goto("/usage");
    const deptTab = page.getByRole("tab", { name: "Department" });
    await deptTab.click();
    await expect(deptTab).toHaveAttribute("aria-selected", "true");

    const usageTable = page.getByRole("table");
    await expect(usageTable.getByText("Engineering")).toBeVisible();
  });
});
