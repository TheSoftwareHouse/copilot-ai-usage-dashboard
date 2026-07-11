/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { DataSource } from "typeorm";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity } from "@/entities/copilot-usage.entity";
import { TeamEntity } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity } from "@/entities/team-member-snapshot.entity";
import { DepartmentEntity } from "@/entities/department.entity";
import {
  DashboardMonthlySummaryEntity,
  type DashboardMonthlySummary,
} from "@/entities/dashboard-monthly-summary.entity";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { UserEntity } from "@/entities/user.entity";
import { SessionEntity } from "@/entities/session.entity";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { JobExecutionEntity } from "@/entities/job-execution.entity";
import { ImportHistoryEntity } from "@/entities/import-history.entity";
import { ApiMode, JobStatus, JobType, UserRole } from "@/entities/enums";
import { refreshDashboardMetrics } from "@/lib/dashboard-metrics";
import { getTestDataSource, cleanDatabase, destroyTestDataSource } from "@/test/db-helpers";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

const seedModule = await import("@/../scripts/seed-demo-may-july-2026");
const {
  seedDemoMayJuly2026,
  demoSeedInternals,
} = seedModule as typeof import("@/../scripts/seed-demo-may-july-2026");

const CONFIRMATION_ENV = demoSeedInternals.REQUIRED_CONFIRMATION_ENV;
const CONFIRMATION_TOKEN = demoSeedInternals.CONFIRMATION_TOKEN;

type TableCounts = {
  usage: number;
  snapshots: number;
  summaries: number;
  seats: number;
  teams: number;
  departments: number;
};

type ProtectedFingerprint = {
  configuration: string;
  appUser: string;
  session: string;
  githubApp: string;
  jobExecution: string;
  importHistory: string;
};

type ReportingFingerprint = {
  seats: string;
  usage: string;
  snapshots: string;
  summaries: string;
};

function setGuardedEnv(databaseName: string, host = "localhost"): void {
  process.env.DATABASE_URL = `postgres://postgres:postgres@${host}:5432/${databaseName}`;
  process.env[CONFIRMATION_ENV] = CONFIRMATION_TOKEN;
}

function clearGuardOverrides(): void {
  delete process.env.ALLOW_DEMO_SEED;
  delete process.env.DEMO_SEED_FAIL_AFTER_CLEANUP;
}

async function reportingTableCounts(ds: DataSource): Promise<TableCounts> {
  return {
    usage: await ds.getRepository(CopilotUsageEntity).count(),
    snapshots: await ds.getRepository(TeamMemberSnapshotEntity).count(),
    summaries: await ds.getRepository(DashboardMonthlySummaryEntity).count(),
    seats: await ds.getRepository(CopilotSeatEntity).count(),
    teams: await ds.getRepository(TeamEntity).count(),
    departments: await ds.getRepository(DepartmentEntity).count(),
  };
}

async function seedPreexistingReportingData(ds: DataSource): Promise<void> {
  const department = await ds.getRepository(DepartmentEntity).save({ name: "legacy-department" });
  const team = await ds.getRepository(TeamEntity).save({ name: "legacy-team" });
  const seat = await ds.getRepository(CopilotSeatEntity).save({
    githubUsername: "legacy-user",
    githubUserId: 10101,
    department: department.name,
    departmentId: department.id,
  });

  await ds.getRepository(TeamMemberSnapshotEntity).save({
    teamId: team.id,
    seatId: seat.id,
    month: 4,
    year: 2026,
    allocationPercentage: 100,
  });

  await ds.getRepository(CopilotUsageEntity).save({
    seatId: seat.id,
    day: 30,
    month: 4,
    year: 2026,
    usageItems: [
      {
        product: "Copilot",
        sku: "Copilot Premium Request",
        model: "Legacy Model",
        unitType: "requests",
        pricePerUnit: 0.5,
        grossQuantity: 10,
        grossAmount: 5,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 10,
        netAmount: 5,
      },
    ],
  });

  await ds.getRepository(DashboardMonthlySummaryEntity).save({
    month: 4,
    year: 2026,
    totalSeats: 1,
    activeSeats: 1,
    totalSpending: 24,
    seatBaseCost: 19,
    totalAiCredits: 10,
    modelUsage: [{ model: "Legacy Model", totalRequests: 10, totalAmount: 5 }],
    mostActiveUsers: [
      {
        seatId: seat.id,
        githubUsername: "legacy-user",
        firstName: null,
        lastName: null,
        totalRequests: 10,
        totalSpending: 5,
      },
    ],
    leastActiveUsers: [
      {
        seatId: seat.id,
        githubUsername: "legacy-user",
        firstName: null,
        lastName: null,
        totalRequests: 10,
        totalSpending: 5,
      },
    ],
  });
}

async function seedProtectedFixtures(ds: DataSource): Promise<void> {
  const user = await ds.getRepository(UserEntity).save({
    username: "protected-admin",
    passwordHash: "hash",
    role: UserRole.ADMIN,
  });

  await ds.getRepository(ConfigurationEntity).save({
    singletonKey: "GLOBAL",
    apiMode: ApiMode.ORGANISATION,
    entityName: "Protected Entity",
    normSeatsCount: 30,
    deviationWarningThreshold: 500,
    deviationAlertThreshold: 1000,
  });

  await ds.getRepository(SessionEntity).save({
    token: "protected-session-token",
    userId: user.id,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    refreshToken: "protected-refresh-token",
  });

  await ds.getRepository(GitHubAppEntity).save({
    singletonKey: "GLOBAL",
    appId: 999,
    appSlug: "protected-app",
    appName: "Protected App",
    privateKeyEncrypted: "enc-private-key",
    webhookSecretEncrypted: "enc-webhook",
    clientId: "client-id",
    clientSecretEncrypted: "enc-client-secret",
    htmlUrl: "https://example.test/protected-app",
    ownerId: 42,
    ownerLogin: "owner-login",
    installationId: 31415,
  });

  await ds.getRepository(JobExecutionEntity).save({
    jobType: JobType.SEAT_SYNC,
    status: JobStatus.SUCCESS,
    reason: "protected",
    startedAt: new Date("2026-05-01T00:00:00.000Z"),
    completedAt: new Date("2026-05-01T00:10:00.000Z"),
    errorMessage: null,
    recordsProcessed: 7,
  });

  await ds.getRepository(ImportHistoryEntity).save({
    filename: "protected.csv",
    executedAt: new Date("2026-05-01T00:00:00.000Z"),
    recordsProcessed: 1,
    matchedUserCount: 1,
    skippedUserCount: 0,
    skippedUsernames: [],
    affectedMonths: [{ month: 4, year: 2026 }],
    overwrittenSeatDayCount: 0,
  });
}

async function protectedFingerprint(ds: DataSource): Promise<ProtectedFingerprint> {
  const configuration = await ds
    .getRepository(ConfigurationEntity)
    .createQueryBuilder("config")
    .select([
      "config.singletonKey AS singletonKey",
      "config.apiMode AS apiMode",
      "config.entityName AS entityName",
      "config.normSeatsCount AS normSeatsCount",
    ])
    .orderBy("config.id", "ASC")
    .getRawMany();

  const appUser = await ds
    .getRepository(UserEntity)
    .createQueryBuilder("user")
    .select(["user.username AS username", "user.passwordHash AS passwordHash", "user.role AS role"])
    .orderBy("user.id", "ASC")
    .getRawMany();

  const session = await ds
    .getRepository(SessionEntity)
    .createQueryBuilder("session")
    .select([
      'session."token" AS token',
      'session."userId" AS userId',
      'session."expiresAt" AS expiresAt',
      'session."refreshToken" AS refreshToken',
    ])
    .orderBy("session.id", "ASC")
    .getRawMany();

  const githubApp = await ds
    .getRepository(GitHubAppEntity)
    .createQueryBuilder("app")
    .select([
      "app.singletonKey AS singletonKey",
      "app.appId AS appId",
      "app.appSlug AS appSlug",
      "app.appName AS appName",
      "app.clientId AS clientId",
      "app.ownerLogin AS ownerLogin",
      "app.installationId AS installationId",
    ])
    .orderBy("app.id", "ASC")
    .getRawMany();

  const jobExecution = await ds
    .getRepository(JobExecutionEntity)
    .createQueryBuilder("job")
    .select([
      'job."jobType" AS jobType',
      'job."status" AS status',
      'job."reason" AS reason',
      'job."recordsProcessed" AS recordsProcessed',
    ])
    .orderBy("job.id", "ASC")
    .getRawMany();

  const importHistory = await ds
    .getRepository(ImportHistoryEntity)
    .createQueryBuilder("history")
    .select([
      "history.filename AS filename",
      'history."recordsProcessed" AS recordsProcessed',
      'history."matchedUserCount" AS matchedUserCount',
      'history."skippedUserCount" AS skippedUserCount',
      'history."overwrittenSeatDayCount" AS overwrittenSeatDayCount',
      'history."affectedMonths" AS affectedMonths',
    ])
    .orderBy("history.id", "ASC")
    .getRawMany();

  return {
    configuration: JSON.stringify(configuration),
    appUser: JSON.stringify(appUser),
    session: JSON.stringify(session),
    githubApp: JSON.stringify(githubApp),
    jobExecution: JSON.stringify(jobExecution),
    importHistory: JSON.stringify(importHistory),
  };
}

function normalizeSummary(summary: DashboardMonthlySummary | null): unknown {
  if (!summary) {
    return null;
  }

  const mostActiveUsers = [...summary.mostActiveUsers]
    .map((entry) => ({
      githubUsername: entry.githubUsername,
      firstName: entry.firstName,
      lastName: entry.lastName,
      totalRequests: entry.totalRequests,
      totalSpending: entry.totalSpending,
    }))
    .sort((a, b) => {
      if (a.totalRequests !== b.totalRequests) {
        return b.totalRequests - a.totalRequests;
      }
      return a.githubUsername.localeCompare(b.githubUsername);
    });

  const leastActiveUsers = [...summary.leastActiveUsers]
    .map((entry) => ({
      githubUsername: entry.githubUsername,
      firstName: entry.firstName,
      lastName: entry.lastName,
      totalRequests: entry.totalRequests,
      totalSpending: entry.totalSpending,
    }))
    .sort((a, b) => {
      if (a.totalRequests !== b.totalRequests) {
        return a.totalRequests - b.totalRequests;
      }
      return a.githubUsername.localeCompare(b.githubUsername);
    });

  return {
    month: summary.month,
    year: summary.year,
    totalSeats: summary.totalSeats,
    activeSeats: summary.activeSeats,
    totalSpending: Number(summary.totalSpending),
    seatBaseCost: Number(summary.seatBaseCost),
    totalAiCredits: summary.totalAiCredits,
    modelUsage: summary.modelUsage,
    mostActiveUsers,
    leastActiveUsers,
  };
}

async function reportingFingerprint(ds: DataSource): Promise<ReportingFingerprint> {
  const seats = await ds
    .getRepository(CopilotSeatEntity)
    .createQueryBuilder("seat")
    .select([
      'seat."githubUsername" AS username',
      'seat."githubUserId" AS githubUserId',
      'seat."firstName" AS firstName',
      'seat."lastName" AS lastName',
      'seat."department" AS department',
    ])
    .orderBy('seat."githubUsername"', "ASC")
    .getRawMany();

  const usage = await ds.query(`
    SELECT
      seat."githubUsername" AS username,
      usage."year" AS year,
      usage."month" AS month,
      usage."day" AS day,
      SUM((item->>'grossQuantity')::int)::int AS quantity,
      SUM((item->>'grossAmount')::numeric)::text AS amount
    FROM copilot_usage usage
    JOIN copilot_seat seat ON seat.id = usage."seatId"
    CROSS JOIN jsonb_array_elements(usage."usageItems") AS item
    GROUP BY seat."githubUsername", usage."year", usage."month", usage."day"
    ORDER BY seat."githubUsername", usage."year", usage."month", usage."day"
  `);

  const snapshots = await ds.query(`
    SELECT
      seat."githubUsername" AS username,
      team."name" AS teamName,
      snapshot."month" AS month,
      snapshot."year" AS year,
      snapshot."allocationPercentage" AS allocation
    FROM team_member_snapshot snapshot
    JOIN copilot_seat seat ON seat.id = snapshot."seatId"
    JOIN team ON team.id = snapshot."teamId"
    ORDER BY seat."githubUsername", snapshot."year", snapshot."month", team."name"
  `);

  const summaries = await ds
    .getRepository(DashboardMonthlySummaryEntity)
    .find({
      where: demoSeedInternals.TARGET_MONTHS.map((month) => ({ month, year: demoSeedInternals.TARGET_YEAR })),
      order: { month: "ASC" },
    });

  return {
    seats: JSON.stringify(seats),
    usage: JSON.stringify(usage),
    snapshots: JSON.stringify(snapshots),
    summaries: JSON.stringify(summaries.map((summary) => normalizeSummary(summary))),
  };
}

describe("seed-demo-may-july-2026", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    clearGuardOverrides();
    setGuardedEnv("copilot_dashboard_test");
  });

  it("fails on missing/wrong confirmation and unsafe targets before writes", async () => {
    await seedPreexistingReportingData(testDs);
    await seedProtectedFixtures(testDs);

    const beforeReporting = await reportingTableCounts(testDs);
    const beforeProtected = await protectedFingerprint(testDs);

    delete process.env[CONFIRMATION_ENV];
    await expect(
      seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs }),
    ).rejects.toThrow(/must equal 'may-july-2026'/i);

    process.env[CONFIRMATION_ENV] = "wrong-confirmation";
    await expect(
      seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs }),
    ).rejects.toThrow(/must equal 'may-july-2026'/i);

    setGuardedEnv("copilot_dashboard_test", "example.com");
    await expect(
      seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs }),
    ).rejects.toThrow(/non-loopback host/i);

    setGuardedEnv("copilot_dashboard");
    await expect(
      seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs }),
    ).rejects.toThrow(/must include local, demo, or test/i);

    process.env.ALLOW_DEMO_SEED = "1";
    await expect(
      seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs }),
    ).resolves.toEqual(
      expect.objectContaining({
        seatCount: 36,
        departmentCount: 4,
        teamCount: 6,
      }),
    );

    const afterProtected = await protectedFingerprint(testDs);
    expect(afterProtected).toEqual(beforeProtected);

    const afterReporting = await reportingTableCounts(testDs);
    expect(afterReporting).toEqual({
      usage: 3312,
      snapshots: 216,
      summaries: 3,
      seats: 36,
      teams: 6,
      departments: 4,
    });

    expect(beforeReporting.usage).toBeGreaterThan(0);
  });

  it("replaces all reporting rows while preserving protected rows", async () => {
    await seedPreexistingReportingData(testDs);
    await seedProtectedFixtures(testDs);

    const protectedBefore = await protectedFingerprint(testDs);

    const result = await seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs });
    expect(result).toEqual(
      expect.objectContaining({
        seatCount: 36,
        teamCount: 6,
        departmentCount: 4,
        usageRowCount: 3312,
        snapshotCount: 216,
        summaryCount: 3,
      }),
    );

    const legacySeat = await testDs
      .getRepository(CopilotSeatEntity)
      .findOne({ where: { githubUsername: "legacy-user" } });
    expect(legacySeat).toBeNull();

    const counts = await reportingTableCounts(testDs);
    expect(counts).toEqual({
      usage: 3312,
      snapshots: 216,
      summaries: 3,
      seats: 36,
      teams: 6,
      departments: 4,
    });

    const protectedAfter = await protectedFingerprint(testDs);
    expect(protectedAfter).toEqual(protectedBefore);
  });

  it("produces exact 92-day and 3,312-row coverage with 2,000-6,000 per-seat/day and 72,000-216,000 per-day totals", async () => {
    await seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs });

    const byMonth = await testDs.query(`
      SELECT usage."month" AS month, COUNT(*)::int AS count
      FROM copilot_usage usage
      GROUP BY usage."month"
      ORDER BY usage."month"
    `);
    expect(byMonth).toEqual([
      { month: 5, count: 1116 },
      { month: 6, count: 1080 },
      { month: 7, count: 1116 },
    ]);

    const byDate = await testDs.query(`
      SELECT
        usage."year" AS year,
        usage."month" AS month,
        usage."day" AS day,
        COUNT(DISTINCT usage.id)::int AS row_count,
        SUM((item->>'grossQuantity')::int)::int AS total_quantity
      FROM copilot_usage usage
      CROSS JOIN jsonb_array_elements(usage."usageItems") AS item
      GROUP BY usage."year", usage."month", usage."day"
      ORDER BY usage."year", usage."month", usage."day"
    `);

    expect(byDate).toHaveLength(92);
    for (const row of byDate) {
      expect(row.row_count).toBe(36);
      expect(row.total_quantity).toBeGreaterThanOrEqual(72000);
      expect(row.total_quantity).toBeLessThanOrEqual(216000);
    }

    const perSeatDay = await testDs.query(`
      SELECT
        usage."seatId" AS seat_id,
        usage."year" AS year,
        usage."month" AS month,
        usage."day" AS day,
        SUM((item->>'grossQuantity')::int)::int AS total_quantity
      FROM copilot_usage usage
      CROSS JOIN jsonb_array_elements(usage."usageItems") AS item
      GROUP BY usage."seatId", usage."year", usage."month", usage."day"
      ORDER BY usage."seatId", usage."year", usage."month", usage."day"
    `);

    expect(perSeatDay).toHaveLength(3312);
    for (const row of perSeatDay) {
      expect(row.total_quantity).toBeGreaterThanOrEqual(2000);
      expect(row.total_quantity).toBeLessThanOrEqual(6000);
    }
  });

  it("enforces deterministic synthetic naming, balanced departments, team allocations, and rerun determinism", async () => {
    const firstResult = await seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs });
    expect(firstResult.snapshotCount).toBe(216);

    const departmentCounts = await testDs.query(`
      SELECT department, COUNT(*)::int AS count
      FROM copilot_seat
      GROUP BY department
      ORDER BY department
    `);

    expect(departmentCounts).toHaveLength(4);
    for (const row of departmentCounts) {
      expect(row.count).toBe(9);
      expect(String(row.department).startsWith(`${demoSeedInternals.SEED_PREFIX}-dept-`)).toBe(true);
    }

    const teamMembers = await testDs.query(`
      SELECT team.name AS team_name, COUNT(snapshot.id)::int AS count
      FROM team
      JOIN team_member_snapshot snapshot ON snapshot."teamId" = team.id
      WHERE snapshot."month" = 5 AND snapshot."year" = 2026
      GROUP BY team.name
      ORDER BY team.name
    `);

    expect(teamMembers).toHaveLength(6);
    for (const row of teamMembers) {
      expect(row.count).toBeGreaterThanOrEqual(6);
      expect(String(row.team_name).startsWith(`${demoSeedInternals.SEED_PREFIX}-project-`)).toBe(true);
    }

    const allocationBySeatMonth = await testDs.query(`
      SELECT
        snapshot."seatId" AS seat_id,
        snapshot."month" AS month,
        snapshot."year" AS year,
        SUM(snapshot."allocationPercentage")::int AS total
      FROM team_member_snapshot snapshot
      GROUP BY snapshot."seatId", snapshot."month", snapshot."year"
      ORDER BY snapshot."seatId", snapshot."month", snapshot."year"
    `);

    expect(allocationBySeatMonth).toHaveLength(108);
    for (const row of allocationBySeatMonth) {
      expect(row.total).toBe(100);
      expect([5, 6, 7]).toContain(row.month);
      expect(row.year).toBe(2026);
    }

    const uniqueRows = await testDs.query(`
      SELECT
        (SELECT COUNT(*)::int FROM (
          SELECT "seatId", "day", "month", "year", COUNT(*)
          FROM copilot_usage
          GROUP BY "seatId", "day", "month", "year"
          HAVING COUNT(*) > 1
        ) duplicates) AS usage_duplicates,
        (SELECT COUNT(*)::int FROM (
          SELECT "teamId", "seatId", "month", "year", COUNT(*)
          FROM team_member_snapshot
          GROUP BY "teamId", "seatId", "month", "year"
          HAVING COUNT(*) > 1
        ) duplicates) AS snapshot_duplicates
    `);

    expect(uniqueRows[0].usage_duplicates).toBe(0);
    expect(uniqueRows[0].snapshot_duplicates).toBe(0);

    const firstFingerprint = await reportingFingerprint(testDs);

    const secondResult = await seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs });
    expect(secondResult).toEqual(firstResult);

    const secondFingerprint = await reportingFingerprint(testDs);
    expect(secondFingerprint).toEqual(firstFingerprint);
  });

  it("creates exactly 3 monthly summaries (May/June/July) and matches canonical recomputation", async () => {
    await seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs });

    const summaryRepo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const initial = await summaryRepo.find({
      where: demoSeedInternals.TARGET_MONTHS.map((month) => ({ month, year: demoSeedInternals.TARGET_YEAR })),
      order: { month: "ASC" },
    });

    expect(initial).toHaveLength(3);

    const normalizedBefore = initial.map((summary) => normalizeSummary(summary));

    for (const month of demoSeedInternals.TARGET_MONTHS) {
      await refreshDashboardMetrics(month, demoSeedInternals.TARGET_YEAR);
    }

    const canonical = await summaryRepo.find({
      where: demoSeedInternals.TARGET_MONTHS.map((month) => ({ month, year: demoSeedInternals.TARGET_YEAR })),
      order: { month: "ASC" },
    });

    expect(canonical).toHaveLength(3);
    const normalizedAfter = canonical.map((summary) => normalizeSummary(summary));
    expect(normalizedAfter).toEqual(normalizedBefore);
  });

  it("rolls back reporting and protected fingerprints when failure is injected after cleanup", async () => {
    await seedPreexistingReportingData(testDs);
    await seedProtectedFixtures(testDs);

    const beforeReporting = await reportingFingerprint(testDs);
    const beforeProtected = await protectedFingerprint(testDs);

    process.env.DEMO_SEED_FAIL_AFTER_CLEANUP = "1";

    await expect(
      seedDemoMayJuly2026(process.env.DATABASE_URL, { dataSource: testDs }),
    ).rejects.toThrow(/Injected failure after cleanup/i);

    const afterReporting = await reportingFingerprint(testDs);
    const afterProtected = await protectedFingerprint(testDs);

    expect(afterReporting).toEqual(beforeReporting);
    expect(afterProtected).toEqual(beforeProtected);
  });
});
