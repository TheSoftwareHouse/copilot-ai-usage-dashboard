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
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

test.describe("Management Tabs", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("navigating to /management shows Seats tab active by default", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management");

    // Page heading
    await expect(
      page.getByRole("heading", { name: /management/i })
    ).toBeVisible();

    // Seats tab is active
    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();

    await expect(page.getByRole("tab", { name: /usage imports/i })).toBeVisible();

    // Seats tab panel is visible
    await expect(
      page.getByRole("tabpanel", { name: /seats/i })
    ).toBeVisible();
  });

  test("clicking each tab shows correct content and updates URL", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management");

    // Click Departments tab
    await page.getByRole("tab", { name: /departments/i }).click();
    await expect(page).toHaveURL(/\?tab=departments/);
    await expect(
      page.getByRole("tab", { name: /departments/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /departments/i })
    ).toBeVisible();

    // Click Project Teams tab
    await page.getByRole("tab", { name: /project teams/i }).click();
    await expect(page).toHaveURL(/\?tab=teams/);
    await expect(
      page.getByRole("tab", { name: /project teams/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /project teams/i })
    ).toBeVisible();

    // Click Usage Imports tab
    await page.getByRole("tab", { name: /usage imports/i }).click();
    await expect(page).toHaveURL(/\?tab=usage-imports/);
    await expect(
      page.getByRole("tab", { name: /usage imports/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /usage imports/i })
    ).toBeVisible();

    // Click Users tab
    await page.getByRole("tab", { name: /users/i }).click();
    await expect(page).toHaveURL(/\?tab=users/);
    await expect(
      page.getByRole("tab", { name: /users/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /users/i })
    ).toBeVisible();

    // Click Configuration tab
    await page.getByRole("tab", { name: /configuration/i }).click();
    await expect(page).toHaveURL(/\?tab=configuration/);
    await expect(
      page.getByRole("tab", { name: /configuration/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /configuration/i })
    ).toBeVisible();

    // Click Seats tab (back to default)
    await page.getByRole("tab", { name: /seats/i }).click();
    await expect(page).toHaveURL(/\?tab=seats/);
    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
  });

  test("navigating directly to /management?tab=departments shows Departments tab active", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=departments");

    await expect(
      page.getByRole("tab", { name: /departments/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /departments/i })
    ).toBeVisible();
  });

  test("navigating directly to /management?tab=teams shows Project Teams tab active", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=teams");

    await expect(
      page.getByRole("tab", { name: /project teams/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /project teams/i })
    ).toBeVisible();
  });

  test("navigating directly to /management?tab=usage-imports shows Usage Imports tab active", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=usage-imports");

    await expect(
      page.getByRole("tab", { name: /usage imports/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /usage imports/i })
    ).toBeVisible();
  });

  test("navigating to /management?tab=jobs falls back to default Seats tab", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=jobs");

    // Jobs tab no longer exists — should fall back to Seats
    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /seats/i })
    ).toBeVisible();
  });

  test("navigating directly to /management?tab=users shows Users tab active", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=users");

    await expect(
      page.getByRole("tab", { name: /users/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /users/i })
    ).toBeVisible();
  });

  test("navigating directly to /management?tab=seats shows Seats tab active", async ({
    page,
  }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=seats");

    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /seats/i })
    ).toBeVisible();
  });

  test("invalid tab param defaults to Seats tab", async ({ page }) => {
    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=nonexistent");

    // Should fall back to Seats
    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: /seats/i })
    ).toBeVisible();
  });
});
