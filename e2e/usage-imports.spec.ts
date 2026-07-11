import { test, expect } from "@playwright/test";
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

async function clearAll() {
  const client = await getClient();
  await client.query("DELETE FROM import_history");
  await client.query("DELETE FROM copilot_usage");
  await client.query("DELETE FROM copilot_seat");
  await client.query("DELETE FROM job_execution");
  await client.query("DELETE FROM dashboard_monthly_summary");
  await client.query("DELETE FROM session");
  await client.query("DELETE FROM app_user");
  await client.query("DELETE FROM configuration");
  await client.end();
}

async function seedSeat(githubUsername: string): Promise<number> {
  const client = await getClient();
  const result = await client.query(
    `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status")
     VALUES ($1, $2, $3)
     RETURNING id`,
    [githubUsername, Math.floor(Math.random() * 1_000_000), "active"],
  );
  await client.end();
  return result.rows[0].id;
}

async function seedGithubApiUsage(
  seatId: number,
  day: number,
  month: number,
  year: number,
): Promise<void> {
  const client = await getClient();
  await client.query(
    `INSERT INTO copilot_usage ("seatId", "day", "month", "year", "source", "usageItems")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      seatId,
      day,
      month,
      year,
      "github_api",
      JSON.stringify([
        {
          product: "Copilot",
          sku: "AIC",
          model: "GPT-4o",
          unitType: "requests",
          pricePerUnit: 0.5,
          grossQuantity: 2,
          grossAmount: 1.25,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 0,
          netAmount: 0,
        },
      ]),
    ],
  );
  await client.end();
}

function buildCsv(rows: string[]): string {
  return [
    "date,username,model,product,sku,aic_quantity,aic_gross_amount",
    ...rows,
  ].join("\n");
}

async function seedRetiredUsageCollectionJob(
  status: string,
  errorMessage: string | null,
  recordsProcessed: number | null,
): Promise<void> {
  const client = await getClient();
  await client.query(
    `INSERT INTO job_execution ("jobType", "status", "startedAt", "completedAt", "errorMessage", "recordsProcessed")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      "usage_collection",
      status,
      new Date().toISOString(),
      new Date().toISOString(),
      errorMessage,
      recordsProcessed,
    ],
  );
  await client.end();
}

function currentUtcPeriod() {
  const now = new Date();
  return {
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
    day: now.getUTCDate(),
  };
}

test.describe("Usage Imports", () => {
  test.beforeEach(async () => {
    await clearAll();
    await seedConfiguration();
    await seedTestUser("admin", "password123");
  });

  test.afterAll(async () => {
    await clearAll();
  });

  test("uploads CSV, shows result summary and import history, and includes usage-collection controls", async ({
    page,
  }) => {
    await seedSeat("octocat");

    const { month, year, day } = currentUtcPeriod();
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });

    const csv = buildCsv([
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")},  OctoCat  ,Claude Sonnet 4.5,Copilot,AIC,10,5.50`,
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")},octocat,GPT-4o,Copilot,AIC,2,1.25`,
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")},missing-user,GPT-4o,Copilot,AIC,3,1.00`,
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management");

    await expect(page.getByRole("tab", { name: /usage imports/i })).toBeVisible();
    await page.getByRole("tab", { name: /usage imports/i }).click();
    await expect(page.getByRole("tabpanel", { name: /usage imports/i })).toBeVisible();

    await expect(page.getByRole("heading", { name: "CSV import", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Usage Collection", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import history", level: 2 })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Last automated collection", level: 3 }),
    ).toBeVisible();
    await expect(page.getByText("No runs yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run today's usage collection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rebuild current month to date" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Current month-to-date rebuild" }),
    ).toHaveCount(0);

    await page.getByLabel("CSV file").setInputFiles({
      name: "billing.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Upload CSV" }).click();

    await expect(page.getByText("Latest import completed")).toBeVisible();
    await expect(page.getByText(/processed 3 records/i)).toBeVisible();
    await expect(page.getByText(/matched 1 user/i)).toBeVisible();
    await expect(page.getByText(/skipped 1 user/i)).toBeVisible();

    const historyCard = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "billing.csv" }) });

    await expect(historyCard).toBeVisible();
    await expect(historyCard.getByText("Records processed")).toBeVisible();
    await expect(historyCard.getByText("Users matched")).toBeVisible();
    await expect(historyCard.getByText(`${monthLabel} ${year}`)).toBeVisible();
    await expect(historyCard.getByText("missing-user")).toBeVisible();
  });

  test("shows last recorded usage collection status with active trigger controls", async ({
    page,
  }) => {
    await seedRetiredUsageCollectionJob(
      "blocked",
      "Usage collection is unavailable for this installation mode.",
      0,
    );

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=usage-imports");

    await expect(
      page.getByRole("heading", { name: "Usage Collection", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Last automated collection", level: 3 }),
    ).toBeVisible();
    await expect(page.getByText("Blocked")).toBeVisible();
    await expect(
      page.getByText("Usage collection is unavailable for this installation mode."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run today's usage collection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rebuild current month to date" }),
    ).toBeVisible();
  });

  test("shows overwrite rule note when CSV overlaps with GitHub API usage", async ({ page }) => {
    const { month, year, day } = currentUtcPeriod();
    const seatId = await seedSeat("octocat");
    await seedGithubApiUsage(seatId, day, month, year);

    const csv = buildCsv([
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")},octocat,GPT-4o,Copilot,AIC,10,5.50`,
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/management?tab=usage-imports");

    await page.getByLabel("CSV file").setInputFiles({
      name: "billing.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Upload CSV" }).click();

    await expect(page.getByText("Overwrite rule")).toBeVisible();
    await expect(
      page.getByText(
        /GitHub API data takes precedence over CSV for the same seat\/day\.\s+Overlapping CSV rows were skipped and reported in this import\./i,
      ),
    ).toBeVisible();
  });

  test("shows dashboard empty state before import and AIC metrics after import", async ({ page }) => {
    await seedSeat("octocat");

    const { month, year, day } = currentUtcPeriod();
    const csv = buildCsv([
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")},octocat,GPT-4o,Copilot,AIC,12,6.00`,
    ]);

    await loginViaApi(page, "admin", "password123");
    await page.goto("/dashboard");

    await expect(page.getByText(/No AIC CSV data has been imported/i)).toBeVisible();

    await page.goto("/management?tab=usage-imports");
    await page.getByLabel("CSV file").setInputFiles({
      name: "billing.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Upload CSV" }).click();
    await expect(page.getByText("Latest import completed")).toBeVisible();

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: /AIC Model Breakdown/i })).toBeVisible();
    await expect(page.getByText("GPT-4o")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Allowance Used/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Most Active Users/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /AIC Model Breakdown/i })).toBeVisible();
  });
});
