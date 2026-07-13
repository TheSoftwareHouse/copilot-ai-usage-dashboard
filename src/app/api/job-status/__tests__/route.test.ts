/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { JobType, JobStatus } from "@/entities/enums";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";

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

const { GET } = await import("@/app/api/job-status/route");
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import(
  "@/lib/auth",
);

async function allowUsageCollectionStatusValues(): Promise<void> {
  await testDs.query(
    `ALTER TYPE "public"."job_execution_status_enum" ADD VALUE IF NOT EXISTS 'blocked'`,
  );
  await testDs.query(
    `ALTER TYPE "public"."job_execution_status_enum" ADD VALUE IF NOT EXISTS 'no_op'`,
  );
}

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

describe("GET /api/job-status", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
    await allowUsageCollectionStatusValues();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
    await seedAuthSession();
  });

  it("returns 401 when no session is provided", async () => {
    mockCookieStore = {};
    const response = await GET();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await cleanDatabase(testDs);
    mockCookieStore = {};
    await seedAuthSession({ role: UserRole.USER });

    const response = await GET();
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns active slots and retired historical slots when no executions exist", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.seatSync).toBeNull();
    expect(json.teamCarryForward).toBeNull();
    expect(json.usageCollection).toBeNull();
    expect(json.retiredJobs).toEqual({
      usageCollection: null,
      monthRecollection: null,
    });
  });

  it("returns latest seat sync execution when multiple exist", async () => {
    const { JobExecutionEntity } = await import(
      "@/entities/job-execution.entity",
    );
    const repo = testDs.getRepository(JobExecutionEntity);

    await repo.save({
      jobType: JobType.SEAT_SYNC,
      status: JobStatus.SUCCESS,
      startedAt: new Date("2026-02-25T10:00:00Z"),
      completedAt: new Date("2026-02-25T10:01:00Z"),
      recordsProcessed: 10,
    });

    await repo.save({
      jobType: JobType.SEAT_SYNC,
      status: JobStatus.FAILURE,
      startedAt: new Date("2026-02-26T10:00:00Z"),
      completedAt: new Date("2026-02-26T10:01:00Z"),
      errorMessage: "API rate limit exceeded",
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.seatSync).not.toBeNull();
    expect(json.seatSync.status).toBe("failure");
    expect(json.seatSync.errorMessage).toBe("API rate limit exceeded");
  });

  it("returns latest team carry-forward execution when it exists", async () => {
    const { JobExecutionEntity } = await import(
      "@/entities/job-execution.entity",
    );
    const repo = testDs.getRepository(JobExecutionEntity);

    await repo.save({
      jobType: JobType.TEAM_CARRY_FORWARD,
      status: JobStatus.SUCCESS,
      startedAt: new Date("2026-03-01T00:00:00Z"),
      completedAt: new Date("2026-03-01T00:00:05Z"),
      recordsProcessed: 12,
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.teamCarryForward).not.toBeNull();
    expect(json.teamCarryForward.jobType).toBe("team_carry_forward");
    expect(json.teamCarryForward.status).toBe("success");
    expect(json.teamCarryForward.recordsProcessed).toBe(12);
  });

  it("returns latest retired usage-collection and month-recollection executions for historical reads", async () => {
    const { JobExecutionEntity } = await import(
      "@/entities/job-execution.entity",
    );
    const repo = testDs.getRepository(JobExecutionEntity);

    await repo.save({
      jobType: JobType.USAGE_COLLECTION,
      status: JobStatus.BLOCKED,
      reason: "unsupported_installation_mode",
      startedAt: new Date("2026-03-02T08:00:00Z"),
      completedAt: new Date("2026-03-02T08:01:00Z"),
      errorMessage: "Usage collection is unavailable for this installation mode.",
      recordsProcessed: 0,
    });

    await repo.save({
      jobType: JobType.MONTH_RECOLLECTION,
      status: JobStatus.FAILURE,
      startedAt: new Date("2026-02-28T14:00:00Z"),
      completedAt: new Date("2026-02-28T14:05:00Z"),
      errorMessage: "GitHub API timeout",
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.usageCollection).not.toBeNull();
    expect(json.usageCollection.jobType).toBe("usage_collection");
    expect(json.usageCollection.reason).toBe("unsupported_installation_mode");
    expect(json.retiredJobs.usageCollection).not.toBeNull();
    expect(json.retiredJobs.usageCollection.jobType).toBe("usage_collection");
    expect(json.retiredJobs.usageCollection.reason).toBe("unsupported_installation_mode");
    expect(json.retiredJobs.monthRecollection).not.toBeNull();
    expect(json.retiredJobs.monthRecollection.jobType).toBe("month_recollection");
    expect(json.retiredJobs.monthRecollection.status).toBe("failure");
  });
});
