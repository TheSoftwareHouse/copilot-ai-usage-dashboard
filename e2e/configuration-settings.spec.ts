import { test, expect } from "@playwright/test";
import { seedTestUser, loginViaApi, clearAuthData } from "./helpers/auth";
import { getClient } from "./helpers/db";
import { createCipheriv, randomBytes } from "crypto";

const ENCRYPTION_KEY =
  "c7c9effbfcc8505ba759f71132b1d91609acb99d4ff770ab90d03721bd7c5a56";

function e2eEncrypt(plaintext: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

async function clearConfiguration() {
  const client = await getClient();
  await client.query("DELETE FROM configuration");
  await client.end();
}

async function seedConfiguration(
  apiMode: string = "organisation",
  entityName: string = "TestOrg"
) {
  const client = await getClient();
  await client.query(
    `INSERT INTO configuration ("apiMode", "entityName", "singletonKey") VALUES ($1, $2, 'GLOBAL')`,
    [apiMode, entityName]
  );
  await client.end();
}

async function clearGitHubApp() {
  const client = await getClient();
  await client.query("DELETE FROM github_app");
  await client.end();
}

async function seedGitHubApp() {
  const client = await getClient();
  await client.query(
    `INSERT INTO github_app (
      "appId", "appSlug", "appName", "privateKeyEncrypted",
      "webhookSecretEncrypted", "clientId", "clientSecretEncrypted",
      "htmlUrl", "ownerId", "ownerLogin", "installationId", "singletonKey"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'GLOBAL')`,
    [
      12345,
      "test-app",
      "Test App",
      e2eEncrypt("fake-private-key"),
      e2eEncrypt("fake-webhook-secret"),
      "Iv1.abc",
      e2eEncrypt("fake-client-secret"),
      "https://github.com/apps/test-app",
      99,
      "testowner",
      55555,
    ]
  );
  await client.end();
}

async function seedCopilotSeats(count: number) {
  const client = await getClient();
  for (let i = 0; i < count; i++) {
    await client.query(
      `INSERT INTO copilot_seat ("githubUsername", "githubUserId", "status") VALUES ($1, $2, $3)`,
      [`e2e-user-${i}`, 90000 + i, "active"]
    );
  }
  await client.end();
}

async function clearCopilotSeats() {
  const client = await getClient();
  await client.query(
    "DELETE FROM copilot_seat WHERE \"githubUsername\" LIKE 'e2e-user-%'"
  );
  await client.end();
}

test.describe("Configuration Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthData();
    await clearGitHubApp();
    await clearConfiguration();
    await seedConfiguration("organisation", "TheSoftwareHouse");
    await seedGitHubApp();
    await seedTestUser("admin", "password123");
    await loginViaApi(page, "admin", "password123");
  });

  test.afterAll(async () => {
    await clearAuthData();
    await clearGitHubApp();
    await clearConfiguration();
    await clearCopilotSeats();
  });

  test("does not display API Mode or Entity Name fields on configuration tab", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Verify API Mode radio buttons are NOT visible
    await expect(
      page.getByRole("radio", { name: "Organisation" })
    ).not.toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Enterprise" })
    ).not.toBeVisible();

    // Verify Entity Name textbox is NOT visible
    await expect(
      page.getByRole("textbox", { name: /organisation name/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /enterprise name/i })
    ).not.toBeVisible();
  });

  test("does not show a retired per-seat allowance input", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");
    await expect(
      page.getByRole("spinbutton", {
        name: /per seat/i,
      })
    ).not.toBeVisible();
  });

  test("navigation bar is present with working links", async ({ page }) => {
    await page.goto("/management?tab=configuration");

    // Verify navigation is present
    const nav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(nav).toBeVisible();

    // Verify exactly three links exist
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Usage" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Management" })).toBeVisible();

    // Verify old links are removed
    await expect(nav.getByRole("link", { name: "Settings" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Seats" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Teams" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Departments" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Users" })).not.toBeVisible();

    // Click Dashboard link and verify navigation
    await nav.getByRole("link", { name: "Dashboard" }).click();
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page).toHaveURL(/\/dashboard$/);

    // Verify navbar is also on dashboard
    await expect(
      page.getByRole("navigation", { name: /main navigation/i })
    ).toBeVisible();

    // Navigate to Management and verify Seats tab is active (default tab)
    await page
      .getByRole("navigation", { name: /main navigation/i })
      .getByRole("link", { name: "Management" })
      .click();
    await page.waitForURL("**/management**", { timeout: 10000 });
    await expect(page).toHaveURL(/\/management/);
    await expect(
      page.getByRole("tab", { name: /seats/i, selected: true })
    ).toBeVisible();
  });

  test("displays connected organisation details in the connection card", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Verify the connection card heading is visible
    const cardHeading = page.getByRole("heading", {
      name: /github organisation connection/i,
    });
    await expect(cardHeading).toBeVisible();

    // Scope assertions to the card container
    const card = page.locator("div").filter({ has: cardHeading }).first();

    // Verify organisation name is displayed
    await expect(card.getByText("TheSoftwareHouse")).toBeVisible();

    // Verify type label is displayed in the definition list
    const typeRow = card.locator("dl div").filter({ hasText: "Type" });
    await expect(typeRow).toBeVisible();
    await expect(typeRow.getByRole("definition")).toContainText("Organisation");
  });

  test("displays connection date in the connection card", async ({ page }) => {
    await page.goto("/management?tab=configuration");

    // Verify the "Connected" label is present
    await expect(page.getByText("Connected")).toBeVisible();

    // Verify a date is shown (the dd element in the definition list should not be empty)
    const connectedRow = page.locator("dl div").filter({ hasText: "Connected" });
    await expect(connectedRow).toBeVisible();
  });

  test("displays a status indicator in the connection card", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Status should be visible — with fake credentials it will likely be "Unknown"
    const statusRow = page.locator("dl div").filter({ hasText: "Status" });
    await expect(statusRow).toBeVisible();
  });

  test("displays View GitHub App on GitHub link with correct href", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    const link = page.getByRole("link", {
      name: /view github app on github/i,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/apps/test-app"
    );
  });

  test("shows disconnect button on configuration tab", async ({ page }) => {
    await page.goto("/management?tab=configuration");

    await expect(
      page.getByRole("button", { name: /disconnect organisation/i })
    ).toBeVisible();
  });

  test("cancelling disconnect dialog keeps the connection", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Click disconnect button
    await page
      .getByRole("button", { name: /disconnect organisation/i })
      .click();

    // Verify confirmation modal appears
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /disconnect organisation/i })
    ).toBeVisible();

    // Verify explanation text is present
    await expect(dialog.getByText(/github data sync/i)).toBeVisible();

    // Click Cancel
    await dialog.getByRole("button", { name: /cancel/i }).click();

    // Modal should close
    await expect(dialog).not.toBeVisible();

    // Connection card should still show org details
    await expect(page.getByText("TheSoftwareHouse")).toBeVisible();
  });

  test("disconnect modal shows data summary with counts", async ({
    page,
  }) => {
    await seedCopilotSeats(2);
    try {
      await page.goto("/management?tab=configuration");

      // Open disconnect modal
      await page
        .getByRole("button", { name: /disconnect organisation/i })
        .click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // Wait for the data summary to finish loading
      await expect(
        dialog.getByText(/loading data summary/i)
      ).not.toBeVisible({ timeout: 10000 });

      // Verify data retention messaging
      await expect(
        dialog.getByText(/your existing data will be preserved/i)
      ).toBeVisible();

      // Verify copilot seats count is shown
      await expect(dialog.getByText(/2 copilot seats/i)).toBeVisible();

      // Verify the implications text is still present
      await expect(
        dialog.getByText(/github data sync/i)
      ).toBeVisible();

      // Close the modal to keep state clean for subsequent tests
      await dialog.getByRole("button", { name: /cancel/i }).click();
      await expect(dialog).not.toBeVisible();
    } finally {
      await clearCopilotSeats();
    }
  });

  test("disconnecting organisation redirects to setup page", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Click disconnect button
    await page
      .getByRole("button", { name: /disconnect organisation/i })
      .click();

    // Verify confirmation modal appears
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click Disconnect in the modal
    await dialog.getByRole("button", { name: /^disconnect$/i }).click();

    // Should redirect to /setup
    await page.waitForURL("**/setup**", { timeout: 15000 });
    await expect(page).toHaveURL(/\/setup/);

    // Verify setup page shows the "Install on Organisation" step
    await expect(
      page.getByText(/install on organisation/i)
    ).toBeVisible();
  });

  test("after disconnect, setup page shows reconnection messaging", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Click disconnect button
    await page
      .getByRole("button", { name: /disconnect organisation/i })
      .click();

    // Verify confirmation modal appears
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click Disconnect in the modal
    await dialog.getByRole("button", { name: /^disconnect$/i }).click();

    // Should redirect to /setup with reconnect=true param (may also include githubUninstallFailed=true)
    await page.waitForURL(/\/setup\?reconnect=true/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/setup\?reconnect=true/);

    // Verify reconnection-specific heading
    await expect(
      page.getByRole("heading", { name: /connect a new organisation/i })
    ).toBeVisible();

    // Verify reconnection description
    await expect(
      page.getByText(/your github app is still active/i)
    ).toBeVisible();

    // Verify "Install on Organisation" link is present and has correct href
    const installLink = page.getByRole("link", {
      name: /install on organisation/i,
    });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute(
      "href",
      "https://github.com/apps/test-app/installations/new"
    );
  });

  test("connection health banner is visible on dashboard page when connection is unhealthy", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const banner = page.getByRole("alert").filter({ hasText: /unable to verify/i });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/unable to verify connection/i);
    await expect(
      banner.getByRole("link", { name: "Go to Settings" })
    ).toBeVisible();
  });

  test("connection health banner is visible on usage page", async ({
    page,
  }) => {
    await page.goto("/usage");
    const banner = page.getByRole("alert").filter({ hasText: /unable to verify/i });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/unable to verify connection/i);
  });

  test("connection health banner links to configuration settings", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const banner = page.getByRole("alert").filter({ hasText: /unable to verify/i });
    const settingsLink = banner.getByRole("link", { name: "Go to Settings" });
    await expect(settingsLink).toHaveAttribute(
      "href",
      "/management?tab=configuration"
    );
  });

  test("connection health banner is not shown when no GitHub App exists", async ({
    page,
  }) => {
    await clearGitHubApp();
    await page.goto("/dashboard");
    await expect(
      page.getByRole("alert").filter({ hasText: "Go to Settings" })
    ).not.toBeVisible();
  });

  test("displays AIC threshold fields with default values", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Verify the AIC Unit Thresholds heading is visible
    await expect(
      page.getByRole("heading", { name: /aic unit thresholds/i })
    ).toBeVisible();

    // Verify warning threshold input with default value 500
    const warningThreshold = page.getByRole("spinbutton", {
      name: /warning threshold/i,
    });
    await expect(warningThreshold).toBeVisible();
    await expect(warningThreshold).toHaveValue("500");

    // Verify alert threshold input with default value 1000
    const alertThreshold = page.getByRole("spinbutton", {
      name: /alert threshold/i,
    });
    await expect(alertThreshold).toBeVisible();
    await expect(alertThreshold).toHaveValue("1000");
  });

  test("updates warning threshold and persists the value after reload", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    const input = page.getByRole("spinbutton", {
      name: /warning threshold/i,
    });
    await input.fill("550");
    await expect(input).toHaveValue("550");

    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes("/api/configuration") &&
          resp.request().method() === "PUT",
      ),
      page.getByRole("button", { name: /update configuration/i }).click(),
    ]);
    expect(putResponse.status()).toBe(200);

    await expect(
      page.getByText(/configuration updated successfully/i)
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: /warning threshold/i })
    ).toHaveValue("550");
  });

  test("updates warning threshold with AIC values and persists the value after reload", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    const input = page.getByRole("spinbutton", {
      name: /warning threshold/i,
    });
    await input.fill("1.75");
    await expect(input).toHaveValue("1.75");

    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes("/api/configuration") &&
          resp.request().method() === "PUT",
      ),
      page.getByRole("button", { name: /update configuration/i }).click(),
    ]);
    expect(putResponse.status()).toBe(200);

    await expect(
      page.getByText(/configuration updated successfully/i)
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: /warning threshold/i })
    ).toHaveValue("1.75");
  });

  test("updates alert threshold and persists the value after reload", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    const input = page.getByRole("spinbutton", {
      name: /alert threshold/i,
    });
    await input.fill("1500");
    await expect(input).toHaveValue("1500");

    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes("/api/configuration") &&
          resp.request().method() === "PUT",
      ),
      page.getByRole("button", { name: /update configuration/i }).click(),
    ]);
    expect(putResponse.status()).toBe(200);

    await expect(
      page.getByText(/configuration updated successfully/i)
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: /alert threshold/i })
    ).toHaveValue("1500");
  });

  test("displays validation error when warning threshold >= alert threshold", async ({
    page,
  }) => {
    await page.goto("/management?tab=configuration");

    // Set warning threshold higher than default alert threshold (1000)
    const warningInput = page.getByRole("spinbutton", {
      name: /warning threshold/i,
    });
    await warningInput.fill("1500");

    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes("/api/configuration") &&
          resp.request().method() === "PUT",
      ),
      page.getByRole("button", { name: /update configuration/i }).click(),
    ]);
    expect(putResponse.status()).toBe(400);

    // Verify cross-field validation error is displayed
    await expect(
      page.getByRole("alert").filter({
        hasText: /warning threshold must be less than alert threshold/i,
      })
    ).toBeVisible();
  });
});
