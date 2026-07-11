/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { JobStatus, JobType, UserRole } from "@/entities/enums";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

vi.mock("@/lib/usage-collection", () => ({
  executeUsageCollection: vi.fn(),
  mapUsageCollectionSkipReason: vi.fn((reason: string) => reason),
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

const { POST } = await import("@/app/api/jobs/month-recollection/route");
const { executeUsageCollection } = await import("@/lib/usage-collection");
const mockedExecuteUsageCollection = vi.mocked(executeUsageCollection);
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import("@/lib/auth");

async function seedAuthSession(options?: { role?: UserRole }): Promise<void> {
  const { UserEntity } = await import("@/entities/user.entity");
  const userRepo = testDs.getRepository(UserEntity);
  const user = await userRepo.save({
    username: "testadmin",
    passwordHash: await hashPassword("testpass"),
    role: options?.role ?? UserRole.ADMIN,
  });
  const token = await createSession(user.id);
  mockCookieStore[SESSION_COOKIE_NAME] = token;
}

describe("POST /api/jobs/month-recollection", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
    vi.clearAllMocks();
  });

  it("returns 401 when no session is provided", async () => {
    const response = await POST();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 403 for non-admin user", async () => {
    await seedAuthSession({ role: UserRole.USER });

    const response = await POST();
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 409 with skipped metadata when month recollection cannot start", async () => {
    await seedAuthSession();
    mockedExecuteUsageCollection.mockResolvedValueOnce({
      skipped: true,
      reason: "already_running",
    });

    const response = await POST();
    expect(response.status).toBe(409);
    const json = await response.json();

    expect(json.skipped).toBe(true);
    expect(json.reason).toBe("already_running");
  });

  it("returns success payload when the job executes", async () => {
    await seedAuthSession();
    mockedExecuteUsageCollection.mockResolvedValueOnce({
      skipped: false,
      jobExecutionId: 12,
      status: JobStatus.PARTIAL_FAILURE,
      recordsProcessed: 18,
      errorMessage: "GitHub API rate limit exceeded",
    });

    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.skipped).toBe(false);
    expect(json.jobExecutionId).toBe(12);
    expect(json.status).toBe("partial_failure");
    expect(json.recordsProcessed).toBe(18);
    expect(json.errorMessage).toBe("GitHub API rate limit exceeded");
    expect(mockedExecuteUsageCollection).toHaveBeenCalledWith({
      jobType: JobType.MONTH_RECOLLECTION,
    });
  });
});