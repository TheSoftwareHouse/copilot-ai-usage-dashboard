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

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
}));

vi.mock("@/lib/auth", () => ({
  seedDefaultAdmin: vi.fn(),
}));

let mockAuthMethod = "credentials";
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

function makeGitHubInstallationResponse(overrides?: Record<string, unknown>) {
  return {
    id: 55555,
    app_id: 12345,
    target_type: "Organization",
    account: {
      login: "acme-corp",
      id: 100,
      type: "Organization",
    },
    ...overrides,
  };
}

async function seedGitHubApp(ds: DataSource) {
  const repo = ds.getRepository(GitHubAppEntity);
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
  });
}

function makeRequest(body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:3000/api/github-app/install", init);
}

const { POST } = await import("@/app/api/github-app/install/route");
const { seedDefaultAdmin } = await import("@/lib/auth");

describe("POST /api/github-app/install", () => {
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
    vi.clearAllMocks();
    mockAuthMethod = "credentials";
  });

  it("returns 400 for missing installationId", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Validation failed");
  });

  it("returns 400 for non-numeric installationId", async () => {
    const response = await POST(makeRequest({ installationId: "abc" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Validation failed");
  });

  it("returns 409 when Configuration already exists", async () => {
    const configRepo = testDs.getRepository(ConfigurationEntity);
    await configRepo.save({
      apiMode: ApiMode.ORGANISATION,
      entityName: "ExistingOrg",
    });

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toBe("Configuration already exists");
  });

  it("returns 404 when no GitHubApp exists", async () => {
    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toContain("GitHub App not found");
  });

  it("returns 409 when GitHubApp already has installationId set", async () => {
    await seedGitHubApp(testDs);
    const repo = testDs.getRepository(GitHubAppEntity);
    const app = await repo.findOne({ where: {} });
    await repo.update(app!.id, { installationId: 99999 });

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toBe("GitHub App is already installed");
  });

  it("returns 201 for valid Organization installation", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(makeGitHubInstallationResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json).toEqual({
      entityName: "acme-corp",
      apiMode: "organisation",
      installationId: 55555,
    });
  });

  it("creates Configuration with correct apiMode and entityName", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(makeGitHubInstallationResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(makeRequest({ installationId: "55555" }));

    const config = await testDs
      .getRepository(ConfigurationEntity)
      .findOne({ where: {} });
    expect(config).not.toBeNull();
    expect(config!.apiMode).toBe("organisation");
    expect(config!.entityName).toBe("acme-corp");
  });

  it("updates GitHubApp installationId in DB", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(makeGitHubInstallationResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(makeRequest({ installationId: "55555" }));

    const app = await testDs
      .getRepository(GitHubAppEntity)
      .findOne({ where: {} });
    expect(app!.installationId).toBe(55555);
  });

  it("returns 201 for Enterprise target_type", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeGitHubInstallationResponse({
            target_type: "Enterprise",
            account: { login: "acme-enterprise", id: 200, type: "Enterprise" },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.apiMode).toBe("enterprise");

    const config = await testDs
      .getRepository(ConfigurationEntity)
      .findOne({ where: {} });
    expect(config!.apiMode).toBe("enterprise");
  });

  it("returns 400 when GitHub API returns 404", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Installation not found");
  });

  it("returns 502 when GitHub API returns 401", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.error).toContain("Failed to authenticate");
  });

  it("returns 400 when target_type is User", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeGitHubInstallationResponse({
            target_type: "User",
            account: { login: "someuser", id: 300, type: "User" },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("not supported");
  });

  it("returns 400 when installation app_id does not match stored appId", async () => {
    await seedGitHubApp(testDs);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(makeGitHubInstallationResponse({ app_id: 99999 })),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(makeRequest({ installationId: "55555" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("does not belong");
  });

  it("calls seedDefaultAdmin in credentials mode", async () => {
    await seedGitHubApp(testDs);
    mockAuthMethod = "credentials";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(makeGitHubInstallationResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(makeRequest({ installationId: "55555" }));
    expect(seedDefaultAdmin).toHaveBeenCalled();
  });

  it("does not call seedDefaultAdmin in azure mode", async () => {
    await seedGitHubApp(testDs);
    mockAuthMethod = "azure";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(makeGitHubInstallationResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await POST(makeRequest({ installationId: "55555" }));
    expect(seedDefaultAdmin).not.toHaveBeenCalled();
  });

  describe("reconnection scenario (after disconnect)", () => {
    it("succeeds after disconnect state with a different org", async () => {
      await seedGitHubApp(testDs);
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeGitHubInstallationResponse({
              id: 77777,
              account: { login: "new-org", id: 200, type: "Organization" },
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const response = await POST(makeRequest({ installationId: "77777" }));
      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json).toEqual({
        entityName: "new-org",
        apiMode: "organisation",
        installationId: 77777,
      });
    });

    it("updates GitHubApp.installationId to the new value", async () => {
      await seedGitHubApp(testDs);
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeGitHubInstallationResponse({
              id: 77777,
              account: { login: "new-org", id: 200, type: "Organization" },
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      await POST(makeRequest({ installationId: "77777" }));

      const app = await testDs
        .getRepository(GitHubAppEntity)
        .findOne({ where: {} });
      expect(app!.installationId).toBe(77777);
    });

    it("creates Configuration with the new org name", async () => {
      await seedGitHubApp(testDs);
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeGitHubInstallationResponse({
              id: 77777,
              account: { login: "new-org", id: 200, type: "Organization" },
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      await POST(makeRequest({ installationId: "77777" }));

      const config = await testDs
        .getRepository(ConfigurationEntity)
        .findOne({ where: {} });
      expect(config).not.toBeNull();
      expect(config!.apiMode).toBe("organisation");
      expect(config!.entityName).toBe("new-org");
    });
  });
});
