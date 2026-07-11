import { test, expect } from "@playwright/test";
import { clearAuthData, seedTestUser, loginViaApi } from "./helpers/auth";
import { getClient } from "./helpers/db";

async function clearConfiguration() {
  const client = await getClient();
  await client.query("DELETE FROM configuration");
  await client.query("DELETE FROM github_app");
  await client.end();
}

test.describe("First-Run Setup Flow", () => {
  test.beforeEach(async () => {
    await clearAuthData();
    await clearConfiguration();
  });

  test.afterAll(async () => {
    await clearAuthData();
    await clearConfiguration();
  });

  test("shows Create GitHub App button when no config or app exists", async ({
    page,
  }) => {
    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: /github app setup/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create github app/i })
    ).toBeVisible();
  });

  test("does not show API mode radio buttons or entity name input", async ({
    page,
  }) => {
    await page.goto("/setup");
    await expect(
      page.getByRole("radio", { name: /organisation/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("radio", { name: /enterprise/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /organisation name/i })
    ).not.toBeVisible();
  });

  test("redirects from /setup to /login when configuration already exists", async ({
    page,
  }) => {
    const client = await getClient();
    await client.query(
      `INSERT INTO configuration ("singletonKey", "apiMode", "entityName")
       VALUES ('GLOBAL', 'organisation', 'AcmeCorp')`
    );
    await client.end();

    await page.goto("/setup");
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test("shows install button when GitHub App exists but no configuration", async ({
    page,
  }) => {
    const client = await getClient();
    await client.query(
      `INSERT INTO github_app ("singletonKey", "appId", "appSlug", "appName", "privateKeyEncrypted", "webhookSecretEncrypted", "clientId", "clientSecretEncrypted", "htmlUrl", "ownerId", "ownerLogin")
       VALUES ('GLOBAL', 12345, 'test-app', 'Test App', 'encrypted-key', 'encrypted-secret', 'Iv1.abc', 'encrypted-client', 'https://github.com/apps/test-app', 99, 'testowner')`
    );
    await client.end();

    await page.goto("/setup");
    await expect(
      page.getByText(/github app created/i)
    ).toBeVisible();
    await expect(
      page.getByText(/test app/i)
    ).toBeVisible();

    const installLink = page.getByRole("link", {
      name: /install on organisation/i,
    });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute(
      "href",
      "https://github.com/apps/test-app/installations/new"
    );
  });

  test("shows connecting message then error when installation_id is present", async ({
    page,
  }) => {
    const client = await getClient();
    await client.query(
      `INSERT INTO github_app ("singletonKey", "appId", "appSlug", "appName", "privateKeyEncrypted", "webhookSecretEncrypted", "clientId", "clientSecretEncrypted", "htmlUrl", "ownerId", "ownerLogin")
       VALUES ('GLOBAL', 12345, 'test-app', 'Test App', 'encrypted-key', 'encrypted-secret', 'Iv1.abc', 'encrypted-client', 'https://github.com/apps/test-app', 99, 'testowner')`
    );
    await client.end();

    await page.goto("/setup?installation_id=12345");
    // The install API will fail since no real GitHub API is available
    await expect(
      page.getByText(/failed|error/i)
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /try again/i })
    ).toBeVisible();
  });

  test("try again button navigates back to install step", async ({
    page,
  }) => {
    const client = await getClient();
    await client.query(
      `INSERT INTO github_app ("singletonKey", "appId", "appSlug", "appName", "privateKeyEncrypted", "webhookSecretEncrypted", "clientId", "clientSecretEncrypted", "htmlUrl", "ownerId", "ownerLogin")
       VALUES ('GLOBAL', 12345, 'test-app', 'Test App', 'encrypted-key', 'encrypted-secret', 'Iv1.abc', 'encrypted-client', 'https://github.com/apps/test-app', 99, 'testowner')`
    );
    await client.end();

    await page.goto("/setup?installation_id=99999");
    await expect(
      page.getByRole("button", { name: /try again/i })
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /try again/i }).click();
    await page.waitForURL("**/setup", { timeout: 10000 });
    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByText(/install on organisation/i)
    ).toBeVisible();
  });

  test("shows error when visiting /setup with invalid code", async ({
    page,
  }) => {
    await page.goto("/setup?code=invalid-code");
    // The callback API will fail since no GitHub server is available
    await expect(
      page.getByText(/failed|error|expired/i)
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /try again/i })
    ).toBeVisible();
  });

  test("credentials-mode admin can log in after setup completion", async ({
    page,
  }) => {
    const client = await getClient();
    await client.query(
      `INSERT INTO github_app ("singletonKey", "appId", "appSlug", "appName", "privateKeyEncrypted", "webhookSecretEncrypted", "clientId", "clientSecretEncrypted", "htmlUrl", "ownerId", "ownerLogin", "installationId")
       VALUES ('GLOBAL', 12345, 'test-app', 'Test App', 'encrypted-key', 'encrypted-secret', 'Iv1.abc', 'encrypted-client', 'https://github.com/apps/test-app', 99, 'testowner', 55555)`
    );
    await client.query(
      `INSERT INTO configuration ("singletonKey", "apiMode", "entityName")
       VALUES ('GLOBAL', 'organisation', 'TestOrg')`
    );
    await client.end();

    await seedTestUser("admin", "password123");

    // Setup page should redirect to login (via /dashboard layout redirect chain)
    await page.goto("/setup");
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page).toHaveURL(/\/login$/);

    // Log in with seeded admin credentials
    await loginViaApi(page, "admin", "password123");

    // Dashboard should now be accessible
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: /sign in/i })
    ).not.toBeVisible();
  });
});
