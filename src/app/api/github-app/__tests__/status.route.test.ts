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

const { GET } = await import("@/app/api/github-app/status/route");
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

describe("GET /api/github-app/status", () => {
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
    const response = await GET();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const response = await GET();
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 404 when no GitHubApp exists", async () => {
    await seedAuthSession();
    const response = await GET();
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("GitHub App not found");
  });

  it("returns 404 when no Configuration exists", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    const response = await GET();
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Configuration not found");
  });

  it("returns 200 with connectionStatus active when GitHub API returns 200 with suspended_at null", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 55555, suspended_at: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.connectionStatus).toBe("active");
    expect(json.appName).toBe("Test App");
    expect(json.appSlug).toBe("test-app");
    expect(json.htmlUrl).toBe("https://github.com/apps/test-app");
    expect(json.entityName).toBe("acme-corp");
    expect(json.apiMode).toBe("organisation");
    expect(json.connectionDate).toBeDefined();
    expect(json.statusMessage).toBeUndefined();
  });

  it("returns 200 with connectionStatus suspended when GitHub API returns 200 with suspended_at set", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 55555,
          suspended_at: "2026-03-01T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.connectionStatus).toBe("suspended");
    expect(json.statusMessage).toBeDefined();
  });

  it("returns 200 with connectionStatus revoked when GitHub API returns 404", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.connectionStatus).toBe("revoked");
    expect(json.statusMessage).toBeDefined();
  });

  it("returns 200 with connectionStatus unknown when GitHub API returns 401", async () => {
    await seedAuthSession();
    await seedGitHubApp();
    await seedConfiguration();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.connectionStatus).toBe("unknown");
    expect(json.statusMessage).toBeDefined();
  });

  it("returns 200 with connectionStatus not_installed when installationId is null", async () => {
    await seedAuthSession();
    await seedGitHubApp({ installationId: null });
    await seedConfiguration();

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.connectionStatus).toBe("not_installed");
    expect(json.statusMessage).toBeDefined();
  });
});
