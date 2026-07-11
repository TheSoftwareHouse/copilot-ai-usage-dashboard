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
  await client.query(
    `DELETE FROM copilot_seat WHERE "githubUsername" LIKE 'dept-e2e-%'`
  );
  await client.query("DELETE FROM department");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
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

async function seedSeatWithDepartment(
  departmentId: number,
  login: string
): Promise<number> {
  const uniqueLogin = `dept-e2e-${login}-${Date.now()}`;
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "lastActivityAt", "createdAt", "departmentId")
     VALUES ($1, $2, NOW(), NOW(), $3) RETURNING id`,
    [uniqueLogin, Math.floor(Math.random() * 1_000_000), departmentId]
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
    [seatId, day, month, year, JSON.stringify(usageItems)]
  );
  await client.end();
}

test.describe("Department Management", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("can navigate to Departments page via Management link", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await page.getByRole("link", { name: "Management" }).click();
    await page.waitForURL("**/management**", { timeout: 10000 });

    await page.getByRole("tab", { name: /departments/i }).click();
    await expect(page).toHaveURL(/\/management\?tab=departments/);
    await expect(
      page.getByRole("tab", { name: /departments/i, selected: true })
    ).toBeVisible();
  });

  test("shows empty state when no departments exist", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    await expect(page.getByText(/no departments found/i)).toBeVisible();
  });

  test("can create a department and it appears in the list", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Click "Add Department" button
    await page.getByRole("button", { name: /add department/i }).click();

    // Modal dialog should be visible with overlay
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("modal-overlay")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /add new department/i })).toBeVisible();

    // Fill the create form within the modal
    await dialog.getByLabel(/department name/i).fill("Engineering");
    await dialog.getByRole("button", { name: /create department/i }).click();

    // Modal should close after successful creation
    await expect(dialog).not.toBeVisible();

    // Wait for the department to appear in the table
    const table = page.locator("table");
    await expect(table.getByText("Engineering")).toBeVisible();
  });

  test("cannot create a department with a duplicate name", async ({
    page,
  }) => {
    await seedDepartment("Engineering");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Verify existing department is shown
    const table = page.locator("table");
    await expect(table.getByText("Engineering")).toBeVisible();

    // Try to create another department with the same name
    await page.getByRole("button", { name: /add department/i }).click();

    // Modal dialog should be visible
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("modal-overlay")).toBeVisible();

    await dialog.getByLabel(/department name/i).fill("Engineering");
    await dialog.getByRole("button", { name: /create department/i }).click();

    // Error should be shown inside the still-open modal
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/already exists/i)
    ).toBeVisible();
  });

  test("pressing Escape closes the create department modal without creating a department", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Open the create modal and fill in a name
    await page.getByRole("button", { name: /add department/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/department name/i).fill("GhostDept");

    // Press Escape to dismiss
    await page.keyboard.press("Escape");

    // Modal should close
    await expect(dialog).not.toBeVisible();

    // No department should have been created
    await expect(page.getByText("GhostDept")).not.toBeVisible();
  });

  test("clicking overlay closes the create department modal without creating a department", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Open the create modal and fill in a name
    await page.getByRole("button", { name: /add department/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/department name/i).fill("OverlayDept");

    // Click on the overlay at the edge to dismiss
    const overlay = page.getByTestId("modal-overlay");
    await overlay.click({ position: { x: 10, y: 10 } });

    // Modal should close
    await expect(dialog).not.toBeVisible();

    // No department should have been created
    await expect(page.getByText("OverlayDept")).not.toBeVisible();
  });

  test("clicking on a department name activates inline text input", async ({ page }) => {
    await seedDepartment("ClickableDept");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "ClickableDept" });

    // Click the department name (rendered as a button by EditableTextCell)
    await row.getByRole("button", { name: /Edit name for department ClickableDept/i }).click();

    // An input should appear with the current name
    const input = table.getByRole("textbox", { name: /Edit name for department ClickableDept/i });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("ClickableDept");
    await expect(input).toBeFocused();
  });

  test("pressing Enter saves the updated department name", async ({ page }) => {
    await seedDepartment("OldName");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "OldName" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for department OldName/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for department OldName/i });
    await input.clear();
    await input.fill("NewName");
    await input.press("Enter");

    // Input should disappear, new name should show
    await expect(input).not.toBeVisible();
    await expect(table.getByText("NewName")).toBeVisible();
    await expect(table.getByText("OldName")).not.toBeVisible();
  });

  test("pressing Escape reverts department name without saving", async ({ page }) => {
    await seedDepartment("KeepMe");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "KeepMe" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for department KeepMe/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for department KeepMe/i });
    await input.clear();
    await input.fill("ChangedName");
    await input.press("Escape");

    // Input should disappear, original name should remain
    await expect(input).not.toBeVisible();
    await expect(table.getByText("KeepMe")).toBeVisible();
    await expect(table.getByText("ChangedName")).not.toBeVisible();
  });

  test("clicking outside (blur) saves the updated department name", async ({ page }) => {
    await seedDepartment("BlurDept");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "BlurDept" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for department BlurDept/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for department BlurDept/i });
    await input.clear();
    await input.fill("BlurSaved");

    // Click outside the input to trigger blur
    await page.locator("body").click();

    // New name should be visible (saved via blur)
    await expect(table.getByText("BlurSaved")).toBeVisible();
    await expect(table.getByText("BlurDept")).not.toBeVisible();
  });

  test("clearing name to empty reverts to original (empty name prevented)", async ({ page }) => {
    await seedDepartment("NonEmpty");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "NonEmpty" });

    // Activate inline edit
    await row.getByRole("button", { name: /Edit name for department NonEmpty/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for department NonEmpty/i });
    await input.clear();
    await input.press("Enter");

    // The original name should remain (empty name rejected)
    await expect(table.getByText("NonEmpty")).toBeVisible();
  });

  test("renaming to a duplicate name reverts to original", async ({ page }) => {
    await seedDepartment("AlphaDept");
    await seedDepartment("BetaDept");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "BetaDept" });

    // Try to rename BetaDept to AlphaDept (duplicate)
    await row.getByRole("button", { name: /Edit name for department BetaDept/i }).click();

    const input = table.getByRole("textbox", { name: /Edit name for department BetaDept/i });
    await input.clear();
    await input.fill("AlphaDept");
    await input.press("Enter");

    // Should revert — BetaDept should still be visible
    await expect(table.getByText("BetaDept")).toBeVisible();
    // Both departments should be present
    await expect(table.getByRole("row").filter({ hasText: "AlphaDept" })).toHaveCount(1);
  });

  test("can delete a department with confirmation", async ({ page }) => {
    await seedDepartment("ToDelete");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Verify department exists in the table first
    const table = page.locator("table");
    await expect(table.getByText("ToDelete")).toBeVisible();

    // Find the row and click Delete
    const row = page.locator("tr", { hasText: "ToDelete" });
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    // Confirm deletion
    await expect(page.getByText(/are you sure/i)).toBeVisible();
    await page.getByRole("button", { name: /yes, delete/i }).click();

    // Department should disappear from the table
    await expect(table.getByText("ToDelete")).not.toBeVisible();
  });

  test("shows seat count warning when deleting department with assigned seats", async ({
    page,
  }) => {
    const deptId = await seedDepartment("WithSeats");
    await seedSeatWithDepartment(deptId, "user-alpha");
    await seedSeatWithDepartment(deptId, "user-beta");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Verify the seat count column shows 2
    const row = page.locator("tr", { hasText: "WithSeats" });
    await expect(row.getByText("2", { exact: true })).toBeVisible();

    // Click Delete
    await row.getByRole("button", { name: /delete/i }).click();

    // Warning should mention seat count
    await expect(
      page.getByText(/this department has 2 seat\(s\) assigned/i)
    ).toBeVisible();

    // Confirm deletion
    await page.getByRole("button", { name: /yes, delete/i }).click();

    // Department should disappear
    await expect(
      page.locator("table").getByText("WithSeats")
    ).not.toBeVisible();
  });

  test("department management table shows seat counts and usage links", async ({
    page,
  }) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const deptId = await seedDepartment("Metrics Dept");
    const seatId = await seedSeatWithDepartment(deptId, "usage-user");
    // 150 AIC Units / (1 × 300) × 100 = 50%
    await seedUsage(seatId, 1, currentMonth, currentYear, [
      { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 150, grossAmount: 6.0, discountQuantity: 150, discountAmount: 6.0, netQuantity: 0, netAmount: 0 },
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");

    const row = table.getByRole("row").filter({ hasText: "Metrics Dept" });
    await expect(row).toContainText("Metrics Dept");
    await expect(row).toContainText("1");
    await expect(row.getByRole("link", { name: /view department usage/i })).toBeVisible();
  });

  test("department with no seats shows zero seat count", async ({ page }) => {
    await seedDepartment("Empty Dept");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    const table = page.locator("table");
    const row = table.getByRole("row").filter({ hasText: "Empty Dept" });
    await expect(row).toContainText("Empty Dept");
    await expect(row).toContainText("0");
  });

  test("after deleting a department, assigned seats have departmentId cleared", async ({
    page,
  }) => {
    const deptId = await seedDepartment("ToClear");
    const seatId = await seedSeatWithDepartment(deptId, "user-gamma");

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    // Delete via UI
    const row = page.locator("tr", { hasText: "ToClear" });
    await row.getByRole("button", { name: /delete/i }).click();
    await page.getByRole("button", { name: /yes, delete/i }).click();

    // Department should be gone
    await expect(
      page.locator("table").getByText("ToClear")
    ).not.toBeVisible();

    // Verify in DB that the seat's departmentId is now NULL
    const client = await getClient();
    const result = await client.query(
      `SELECT "departmentId" FROM copilot_seat WHERE id = $1`,
      [seatId]
    );
    await client.end();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].departmentId).toBeNull();
  });
});
