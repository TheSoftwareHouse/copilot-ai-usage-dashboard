/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity } from "@/entities/copilot-usage.entity";
import { TeamEntity } from "@/entities/team.entity";
import { DepartmentEntity } from "@/entities/department.entity";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import { SeatStatus } from "@/entities/enums";

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

const { GET } = await import(
  "@/app/api/github-app/disconnect-preview/route"
);
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

async function seedSeat(
  overrides?: Partial<{ githubUsername: string; githubUserId: number }>,
) {
  const repo = testDs.getRepository(CopilotSeatEntity);
  return repo.save({
    githubUsername: "user1",
    githubUserId: 1001,
    status: SeatStatus.ACTIVE,
    ...overrides,
  });
}

async function seedUsage(seatId: number) {
  const repo = testDs.getRepository(CopilotUsageEntity);
  return repo.save({
    seatId,
    day: 1,
    month: 3,
    year: 2026,
    usageItems: [],
  });
}

async function seedTeam(
  overrides?: Partial<{ name: string; deletedAt: Date | null }>,
) {
  const repo = testDs.getRepository(TeamEntity);
  return repo.save({
    name: "team-alpha",
    ...overrides,
  });
}

async function seedDepartment(name = "Engineering") {
  const repo = testDs.getRepository(DepartmentEntity);
  return repo.save({ name });
}

async function seedMonthlySummary(
  overrides?: Partial<{ month: number; year: number }>,
) {
  const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
  return repo.save({
    month: 3,
    year: 2026,
    totalSeats: 10,
    activeSeats: 8,
    totalSpending: 100,
    seatBaseCost: 50,
    totalAiCredits: 200,
    modelUsage: [],
    mostActiveUsers: [],
    leastActiveUsers: [],
    ...overrides,
  });
}

describe("GET /api/github-app/disconnect-preview", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
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

  it("returns 200 with all-zero counts when no data exists", async () => {
    await seedAuthSession();

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      seats: 0,
      usageRecords: 0,
      teams: 0,
      departments: 0,
      monthlySummaries: 0,
    });
  });

  it("returns 200 with correct counts when data is seeded", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat({
      githubUsername: "user1",
      githubUserId: 1001,
    });
    const seat2 = await seedSeat({
      githubUsername: "user2",
      githubUserId: 1002,
    });
    await seedUsage(seat1.id);
    await seedUsage(seat2.id);
    await seedTeam({ name: "team-alpha" });
    await seedTeam({ name: "team-beta" });
    await seedTeam({ name: "team-gamma" });
    await seedDepartment("Engineering");
    await seedDepartment("Design");
    await seedMonthlySummary({ month: 1, year: 2026 });
    await seedMonthlySummary({ month: 2, year: 2026 });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      seats: 2,
      usageRecords: 2,
      teams: 3,
      departments: 2,
      monthlySummaries: 2,
    });
  });

  it("excludes soft-deleted teams from count", async () => {
    await seedAuthSession();

    await seedTeam({ name: "active-team", deletedAt: null });
    await seedTeam({ name: "deleted-team", deletedAt: new Date() });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.teams).toBe(1);
  });
});
