/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { existsSync } from "node:fs";
import { JobType, JobStatus, UserRole } from "@/entities/enums";
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

async function seedAdminSession(): Promise<void> {
  const { UserEntity } = await import("@/entities/user.entity");
  const userRepo = testDs.getRepository(UserEntity);
  const user = await userRepo.save({
    username: "testadmin",
    passwordHash: await hashPassword("testpass"),
    role: UserRole.ADMIN,
  });

  const token = await createSession(user.id);
  mockCookieStore[SESSION_COOKIE_NAME] = token;
}

describe("retired job types", () => {
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
    await seedAdminSession();
  });

  it("reads persisted usage-collection and month-recollection rows through JobExecutionEntity and GET /api/job-status", async () => {
    const { JobExecutionEntity } = await import("@/entities/job-execution.entity");
    const repository = testDs.getRepository(JobExecutionEntity);

    await repository.save({
      jobType: JobType.USAGE_COLLECTION,
      status: JobStatus.BLOCKED,
      reason: "unsupported_installation_mode",
      startedAt: new Date("2026-06-10T10:00:00.000Z"),
      completedAt: new Date("2026-06-10T10:01:00.000Z"),
      errorMessage: "Usage collection is unavailable for this installation mode.",
      recordsProcessed: 0,
    });

    await repository.save({
      jobType: JobType.MONTH_RECOLLECTION,
      status: JobStatus.FAILURE,
      startedAt: new Date("2026-06-11T10:00:00.000Z"),
      completedAt: new Date("2026-06-11T10:01:00.000Z"),
      errorMessage: "Month recollection retired.",
      recordsProcessed: null,
    });

    const persisted = await repository.find({
      where: [
        { jobType: JobType.USAGE_COLLECTION },
        { jobType: JobType.MONTH_RECOLLECTION },
      ],
      order: { startedAt: "ASC" },
    });

    expect(persisted).toHaveLength(2);
    expect(persisted[0].jobType).toBe(JobType.USAGE_COLLECTION);
    expect(persisted[1].jobType).toBe(JobType.MONTH_RECOLLECTION);

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.retiredJobs).toBeDefined();
    expect(json.retiredJobs.usageCollection.jobType).toBe("usage_collection");
    expect(json.retiredJobs.monthRecollection.jobType).toBe("month_recollection");

    expect(existsSync("src/app/api/jobs/usage-collection/route.ts")).toBe(true);
    expect(existsSync("src/app/api/jobs/month-recollection/route.ts")).toBe(true);
    expect(existsSync("src/lib/usage-collection.ts")).toBe(true);
  });
});
