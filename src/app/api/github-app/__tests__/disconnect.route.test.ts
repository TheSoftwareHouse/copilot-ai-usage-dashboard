/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { ApiMode } from "@/entities/enums";
import { encrypt } from "@/lib/encryption";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

let mockCookieStore: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookieStore[name];
      return value !== undefined ? { value } : undefined;
    },
  }),
}));

let mockAuthMethod: "credentials" | "azure" = "credentials";
vi.mock("@/lib/auth-config", () => ({
  getAuthMethod: () => mockAuthMethod,
}));

const VALID_ENCRYPTION_KEY =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const { POST } = await import("@/app/api/github-app/disconnect/route");
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import(
  "@/lib/auth"
);

async function seedAuthSession(options?: { role?: string }): Promise<void> {
  const { UserEntity } = await import("@/entities/user.entity");
  const { UserRole } = await import("@/entities/enums");
  const userRepo = testDs.getRepository(UserEntity);
  const user = await userRepo.save({
    username: "testadmin",
    passwordHash: await hashPassword("testpass"),
    role: options?.role ?? UserRole.ADMIN,
  });
  const token = await createSession(user.id);
  mockCookieStore[SESSION_COOKIE_NAME] = token;
}

async function seedGitHubApp(
  overrides?: Partial<{ installationId: number | null }>,
) {
  const repo = testDs.getRepository(GitHubAppEntity);
  await repo.save({
    appId: 12345,
    appSlug: "test-app",
    appName: "Test App",
    privateKeyEncrypted: encrypt(privateKey),
    webhookSecretEncrypted: encrypt("webhook-secret"),
    clientId: "Iv1.abc",
    clientSecretEncrypted: encrypt("client-secret"),
    htmlUrl: "https://github.com/apps/test-app",
    ownerId: 99,
    ownerLogin: "testowner",
    installationId: 55555,
    ...overrides,
  });
}

async function seedConfiguration() {
  const repo = testDs.getRepository(ConfigurationEntity);
  await repo.save({
    apiMode: ApiMode.ORGANISATION,
    entityName: "acme-corp",
  });
}

describe("POST /api/github-app/disconnect", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
    process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
  });

  afterAll(async () => {
    delete process.env.ENCRYPTION_KEY;
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
    mockAuthMethod = "credentials";
    vi.restoreAllMocks();
  });

  it("returns 401 when no session", async () => {
    const response = await POST();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const response = await POST();
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 404 when no GitHubApp exists", async () => {
    await seedAuthSession();
    const response = await POST();
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("GitHub App not found");
  });

  it("returns 404 when installationId is already null", async () => {
    await seedAuthSession();
    await seedGitHubApp({ installationId: null });
    const response = await POST();
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("No organisation is currently connected");
  });

  it("returns 200 and nullifies installationId on success", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.message).toBe("Organisation disconnected successfully");
    expect(json.githubUninstalled).toBe(true);

    const app = await testDs.getRepository(GitHubAppEntity).findOne({ where: {} });
    expect(app).not.toBeNull();
    expect(app!.installationId).toBeNull();
  });

  it("returns 200 and deletes Configuration row on success", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const response = await POST();
    expect(response.status).toBe(200);

    const config = await testDs
      .getRepository(ConfigurationEntity)
      .findOne({ where: {} });
    expect(config).toBeNull();
  });

  it("preserves GitHubApp row after disconnect", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await POST();

    const app = await testDs.getRepository(GitHubAppEntity).findOne({ where: {} });
    expect(app).not.toBeNull();
    expect(app!.appId).toBe(12345);
    expect(app!.appSlug).toBe("test-app");
    expect(app!.installationId).toBeNull();
  });

  it("returns githubUninstalled: true when GitHub API returns 204", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.githubUninstalled).toBe(true);
    expect(json.message).toBe("Organisation disconnected successfully");

    const app = await testDs.getRepository(GitHubAppEntity).findOne({ where: {} });
    expect(app!.installationId).toBeNull();
    const config = await testDs.getRepository(ConfigurationEntity).findOne({ where: {} });
    expect(config).toBeNull();
  });

  it("returns githubUninstalled: true when GitHub API returns 404", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.githubUninstalled).toBe(true);
    expect(json.message).toBe("Organisation disconnected successfully");
  });

  it("returns githubUninstalled: false when GitHub API returns 401", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.githubUninstalled).toBe(false);
    expect(json.message).toBe("Organisation disconnected successfully");

    const app = await testDs.getRepository(GitHubAppEntity).findOne({ where: {} });
    expect(app!.installationId).toBeNull();
  });

  it("returns githubUninstalled: false when fetch throws network error", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.githubUninstalled).toBe(false);
    expect(json.message).toBe("Organisation disconnected successfully");

    const app = await testDs.getRepository(GitHubAppEntity).findOne({ where: {} });
    expect(app!.installationId).toBeNull();
  });
});
