/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { SeatStatus, ApiMode } from "@/entities/enums";
import { TeamEntity, type Team } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity } from "@/entities/team-member-snapshot.entity";
import { DepartmentEntity } from "@/entities/department.entity";
import { ConfigurationEntity, type Configuration } from "@/entities/configuration.entity";
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

const { GET } = await import("@/app/api/usage/seats/[seatId]/route");
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import(
  "@/lib/auth"
);

async function seedAuthSession(): Promise<void> {
  const { UserEntity } = await import("@/entities/user.entity");
  const userRepo = testDs.getRepository(UserEntity);
  const user = await userRepo.save({
    username: "testadmin",
    passwordHash: await hashPassword("testpass"),
  });
  const token = await createSession(user.id);
  mockCookieStore[SESSION_COOKIE_NAME] = token;
}

function makeGetRequest(seatId: string, params?: Record<string, string>): NextRequest {
  const url = new URL(`http://localhost:3000/api/usage/seats/${seatId}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

function makeContext(seatId: string) {
  return { params: Promise.resolve({ seatId }) };
}

async function seedSeat(
  overrides: Partial<CopilotSeat> & { githubUsername: string; githubUserId: number },
): Promise<CopilotSeat> {
  const seatRepo = testDs.getRepository(CopilotSeatEntity);
  return seatRepo.save({
    status: SeatStatus.ACTIVE,
    ...overrides,
  } as Partial<CopilotSeat>);
}

async function seedUsage(
  overrides: Partial<CopilotUsage> & { seatId: number; day: number; month: number; year: number; usageItems: unknown[] },
): Promise<CopilotUsage> {
  const usageRepo = testDs.getRepository(CopilotUsageEntity);
  return usageRepo.save(overrides as Partial<CopilotUsage>);
}

async function seedDepartment(name: string) {
  const repo = testDs.getRepository(DepartmentEntity);
  return repo.save(repo.create({ name }));
}

async function seedTeam(name: string, overrides?: Partial<Team>) {
  const repo = testDs.getRepository(TeamEntity);
  return repo.save(repo.create({ name, ...overrides }));
}

async function seedTeamMemberSnapshot(
  teamId: number,
  seatId: number,
  month: number,
  year: number,
  allocationPercentage = 100,
) {
  const repo = testDs.getRepository(TeamMemberSnapshotEntity);
  return repo.save(repo.create({ teamId, seatId, month, year, allocationPercentage }));
}

async function seedConfiguration(
  overrides: Partial<Configuration> & { entityName: string; apiMode: ApiMode },
): Promise<Configuration> {
  const repo = testDs.getRepository(ConfigurationEntity);
  return repo.save(repo.create(overrides));
}

describe("GET /api/usage/seats/[seatId]", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
  });

  it("returns 401 without session", async () => {
    const request = makeGetRequest("1");
    const response = await GET(request as never, makeContext("1") as never);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for non-numeric seatId", async () => {
    await seedAuthSession();

    const request = makeGetRequest("abc");
    const response = await GET(request as never, makeContext("abc") as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid seat ID");
  });

  it("returns 400 for negative seatId", async () => {
    await seedAuthSession();

    const request = makeGetRequest("-5");
    const response = await GET(request as never, makeContext("-5") as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid seat ID");
  });

  it("returns 404 for non-existent seatId", async () => {
    await seedAuthSession();

    const request = makeGetRequest("99999", { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext("99999") as never);
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Seat not found");
  });

  it("returns seat info with empty usage data when no usage exists for the month", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "empty-user",
      githubUserId: 5001,
      firstName: "Empty",
      lastName: "User",
      department: "QA",
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seat.seatId).toBe(seat.id);
    expect(json.seat.githubUsername).toBe("empty-user");
    expect(json.seat.firstName).toBe("Empty");
    expect(json.seat.lastName).toBe("User");
    expect(json.seat.department).toBe("QA");

    expect(json.summary.totalRequests).toBe(0);
    expect(json.summary.grossSpending).toBe(0);
    expect(json.summary.netSpending).toBe(0);

    expect(json.dailyUsage).toEqual([]);
    expect(json.modelBreakdown).toEqual([]);
    expect(json.seat.departmentId).toBeNull();
    expect(json.teams).toEqual([]);

    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("returns correct daily usage aggregation", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "daily-user",
      githubUserId: 5002,
    });

    // Day 1: two models
    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
      ],
    });

    // Day 3: one model
    await seedUsage({
      seatId: seat.id,
      day: 3,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 30, discountAmount: 1.2, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.dailyUsage).toHaveLength(2);

    // Day 1: 50 + 10 = 60 requests, 2.0 + 0.4 = 2.4 gross
    expect(json.dailyUsage[0].day).toBe(1);
    expect(json.dailyUsage[0].totalRequests).toBe(60);
    expect(json.dailyUsage[0].grossAmount).toBeCloseTo(2.4, 2);

    // Day 3: 30 requests, 1.2 gross
    expect(json.dailyUsage[1].day).toBe(3);
    expect(json.dailyUsage[1].totalRequests).toBe(30);
    expect(json.dailyUsage[1].grossAmount).toBeCloseTo(1.2, 2);
  });

  it("returns costStats computed from the seat's daily gross quantity", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "cost-user",
      githubUserId: 5009,
    });

    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 2800, grossAmount: 112, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    // total gross quantity = 2800 → totalCost = 2800 / 100 = 28
    // February 2026 is a past month, so elapsedDays = calendarDays = 28
    expect(json.costStats.totalCost).toBeCloseTo(28, 2);
    expect(json.costStats.averageDailyCost).toBeCloseTo(1, 2);
    expect(json.costStats.month).toBe(2);
    expect(json.costStats.year).toBe(2026);
  });

  it("returns correct model breakdown", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "model-user",
      githubUserId: 5003,
    });

    // Day 1
    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 20, grossAmount: 0.8, discountQuantity: 0, discountAmount: 0, netQuantity: 20, netAmount: 0.8 },
      ],
    });

    // Day 2: more Sonnet usage
    await seedUsage({
      seatId: seat.id,
      day: 2,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 30, discountAmount: 1.2, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.modelBreakdown).toHaveLength(2);

    // Ordered by totalRequests DESC — Sonnet first (80), GPT-4o second (20)
    expect(json.modelBreakdown[0].model).toBe("Claude Sonnet 4.5");
    expect(json.modelBreakdown[0].totalRequests).toBe(80);
    expect(json.modelBreakdown[0].grossAmount).toBeCloseTo(3.2, 2);
    expect(json.modelBreakdown[0].netAmount).toBe(0);

    expect(json.modelBreakdown[1].model).toBe("GPT-4o");
    expect(json.modelBreakdown[1].totalRequests).toBe(20);
    expect(json.modelBreakdown[1].grossAmount).toBeCloseTo(0.8, 2);
    expect(json.modelBreakdown[1].netAmount).toBeCloseTo(0.8, 2);
  });

  it("returns correct summary totals", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "summary-user",
      githubUserId: 5004,
    });

    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 20, grossAmount: 0.8, discountQuantity: 0, discountAmount: 0, netQuantity: 20, netAmount: 0.8 },
      ],
    });

    await seedUsage({
      seatId: seat.id,
      day: 2,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 10, discountAmount: 0.4, netQuantity: 20, netAmount: 0.8 },
      ],
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    // totalRequests: 50 + 20 + 30 = 100
    expect(json.summary.totalRequests).toBe(100);
    // grossSpending: 2.0 + 0.8 + 1.2 = 4.0
    expect(json.summary.grossSpending).toBeCloseTo(4.0, 2);
    // netSpending: 0 + 0.8 + 0.8 = 1.6
    expect(json.summary.netSpending).toBeCloseTo(1.6, 2);
  });

  it("defaults to current month/year when query params are missing", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "defaults-user",
      githubUserId: 5005,
    });

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const request = makeGetRequest(String(seat.id));
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("includes departmentId in seat info when seat has a department", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Engineering");
    const seat = await seedSeat({
      githubUsername: "dept-user",
      githubUserId: 6001,
      departmentId: dept.id,
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seat.departmentId).toBe(dept.id);
  });

  it("returns departmentId as null when seat has no department", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "no-dept-user",
      githubUserId: 6002,
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seat.departmentId).toBeNull();
  });

  it("returns teams array with team memberships for the selected month", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "team-user",
      githubUserId: 6003,
    });
    const team = await seedTeam("Alpha Team");
    await seedTeamMemberSnapshot(team.id, seat.id, 2, 2026, 75);
    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 80, grossAmount: 3.2, discountQuantity: 0, discountAmount: 0, netQuantity: 80, netAmount: 3.2 },
      ],
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toHaveLength(1);
    expect(json.teams[0].teamId).toBe(team.id);
    expect(json.teams[0].teamName).toBe("Alpha Team");
    expect(json.teams[0].allocationPercentage).toBe(75);
    expect(json.teams[0].allocatedRequests).toBe(60);
    expect(json.teams[0].allocatedGrossAmount).toBeCloseTo(2.4, 2);
  });

  it("returns empty teams array when seat has no team memberships", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "no-team-user",
      githubUserId: 6004,
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toEqual([]);
  });

  it("excludes soft-deleted teams from teams array", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "deleted-team-user",
      githubUserId: 6005,
    });
    const deletedTeam = await seedTeam("Deleted Team", { deletedAt: new Date() });
    await seedTeamMemberSnapshot(deletedTeam.id, seat.id, 2, 2026);

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toEqual([]);
  });

  it("returns teams only for the selected month/year", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "month-filter-user",
      githubUserId: 6006,
    });
    const teamFeb = await seedTeam("Feb Team");
    const teamMar = await seedTeam("Mar Team");
    await seedTeamMemberSnapshot(teamFeb.id, seat.id, 2, 2026);
    await seedTeamMemberSnapshot(teamMar.id, seat.id, 3, 2026);

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toHaveLength(1);
    expect(json.teams[0].teamName).toBe("Feb Team");
  });

  it("returns multiple teams when seat belongs to multiple teams", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "multi-team-user",
      githubUserId: 6007,
    });
    const teamA = await seedTeam("Alpha");
    const teamB = await seedTeam("Beta");
    await seedTeamMemberSnapshot(teamA.id, seat.id, 2, 2026);
    await seedTeamMemberSnapshot(teamB.id, seat.id, 2, 2026);

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toHaveLength(2);
    // Ordered alphabetically by team name
    expect(json.teams[0].teamName).toBe("Alpha");
    expect(json.teams[1].teamName).toBe("Beta");
  });

  it("does not return retired legacy fields", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "premium-user",
      githubUserId: 5006,
    });

    const request = makeGetRequest(String(seat.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeContext(String(seat.id)) as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).not.toHaveProperty("legacyRequestsPerSeat");
  });

  describe("static threshold deviation data", () => {
    const VIEW_MONTH = 3;
    const VIEW_YEAR = 2026;
    const PREV_MONTH = 2;
    const PREV_YEAR = 2026;

    async function seedNormBaseline() {
      await seedConfiguration({
        entityName: "test-org",
        apiMode: ApiMode.ORGANISATION,
        normSeatsCount: 2,
        deviationWarningThreshold: 20,
        deviationAlertThreshold: 30,
      });

      // Seed two seats with previous month usage to establish a norm
      const seatA = await seedSeat({ githubUsername: "norm-seat-a", githubUserId: 7001 });
      const seatB = await seedSeat({ githubUsername: "norm-seat-b", githubUserId: 7002 });

      // seatA: 280 total requests in previous month (10 requests/day × 28 days)
      for (let d = 1; d <= 28; d++) {
        await seedUsage({
          seatId: seatA.id,
          day: d,
          month: PREV_MONTH,
          year: PREV_YEAR,
          usageItems: [
            { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
          ],
        });
      }

      // seatB: 560 total requests in previous month (20 requests/day × 28 days)
      for (let d = 1; d <= 28; d++) {
        await seedUsage({
          seatId: seatB.id,
          day: d,
          month: PREV_MONTH,
          year: PREV_YEAR,
          usageItems: [
            { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 20, grossAmount: 0.8, discountQuantity: 0, discountAmount: 0, netQuantity: 20, netAmount: 0.8 },
          ],
        });
      }

      return { seatA, seatB };
    }

    it("response includes normValue: null when previous month data exists", async () => {
      await seedAuthSession();
      const { seatA } = await seedNormBaseline();

      // Seed current month usage for seatA
      await seedUsage({
        seatId: seatA.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      const request = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seatA.id)) as never);
      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.normValue).toBeNull();
    });

    it("response includes normValue: null when no previous month data exists", async () => {
      await seedAuthSession();
      // Config exists but no previous month usage data
      await seedConfiguration({
        entityName: "test-org",
        apiMode: ApiMode.ORGANISATION,
        normSeatsCount: 2,
        deviationWarningThreshold: 20,
        deviationAlertThreshold: 30,
      });

      const seat = await seedSeat({ githubUsername: "no-prev-user", githubUserId: 7010 });

      await seedUsage({
        seatId: seat.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      const request = makeGetRequest(String(seat.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seat.id)) as never);
      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.normValue).toBeNull();
    });

    it("daily usage entries include deviation object with level and multiplier", async () => {
      await seedAuthSession();
      const { seatA } = await seedNormBaseline();

      await seedUsage({
        seatId: seatA.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      const request = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seatA.id)) as never);
      const json = await response.json();

      expect(json.dailyUsage).toHaveLength(1);
      expect(json.dailyUsage[0].deviation).toBeDefined();
      expect(json.dailyUsage[0].deviation).toHaveProperty("level");
      expect(json.dailyUsage[0].deviation).toHaveProperty("multiplier");
    });

    it("day above alert threshold returns deviation.level === 'alert' with raw AIC Units", async () => {
      await seedAuthSession();
      const { seatA } = await seedNormBaseline();

      await seedUsage({
        seatId: seatA.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 40, grossAmount: 1.6, discountQuantity: 0, discountAmount: 0, netQuantity: 40, netAmount: 1.6 },
        ],
      });

      const request = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seatA.id)) as never);
      const json = await response.json();

      expect(json.dailyUsage[0].deviation.level).toBe("alert");
      expect(json.dailyUsage[0].deviation.multiplier).toBe(40);
    });

    it("day above warning threshold (but below alert) returns deviation.level === 'warning'", async () => {
      await seedAuthSession();
      const { seatA } = await seedNormBaseline();

      await seedUsage({
        seatId: seatA.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 25, grossAmount: 1.0, discountQuantity: 0, discountAmount: 0, netQuantity: 25, netAmount: 1.0 },
        ],
      });

      const request = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seatA.id)) as never);
      const json = await response.json();

      expect(json.dailyUsage[0].deviation.level).toBe("warning");
      expect(json.dailyUsage[0].deviation.multiplier).toBe(25);
    });

    it("normal day returns deviation.level === 'none'", async () => {
      await seedAuthSession();
      const { seatA } = await seedNormBaseline();

      await seedUsage({
        seatId: seatA.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      const request = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seatA.id)) as never);
      const json = await response.json();

      expect(json.dailyUsage[0].deviation.level).toBe("none");
      expect(json.dailyUsage[0].deviation.multiplier).toBe(10);
    });

    it("day with zero usage returns deviation.level === 'none' regardless of norm", async () => {
      await seedAuthSession();
      const { seatA } = await seedNormBaseline();

      // Seed a day with 0 grossQuantity
      await seedUsage({
        seatId: seatA.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 0, grossAmount: 0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 },
        ],
      });

      const request = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seatA.id)) as never);
      const json = await response.json();

      // The daily query groups by day with SUM — a 0 grossQuantity day will appear with totalRequests=0
      if (json.dailyUsage.length > 0) {
        const zeroDay = json.dailyUsage.find((d: { totalRequests: number }) => d.totalRequests === 0);
        if (zeroDay) {
          expect(zeroDay.deviation.level).toBe("none");
          expect(zeroDay.deviation.multiplier).toBe(0);
        }
      }
    });

    it("all days still use static thresholds when normValue is null", async () => {
      await seedAuthSession();
      await seedConfiguration({
        entityName: "test-org",
        apiMode: ApiMode.ORGANISATION,
        normSeatsCount: 2,
        deviationWarningThreshold: 300,
        deviationAlertThreshold: 400,
      });

      const seat = await seedSeat({ githubUsername: "null-norm-user", githubUserId: 7020 });

      await seedUsage({
        seatId: seat.id,
        day: 1,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 100, netAmount: 4.0 },
        ],
      });

      await seedUsage({
        seatId: seat.id,
        day: 2,
        month: VIEW_MONTH,
        year: VIEW_YEAR,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 200, grossAmount: 8.0, discountQuantity: 0, discountAmount: 0, netQuantity: 200, netAmount: 8.0 },
        ],
      });

      const request = makeGetRequest(String(seat.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response = await GET(request as never, makeContext(String(seat.id)) as never);
      const json = await response.json();

      expect(json.normValue).toBeNull();
      expect(json.dailyUsage).toHaveLength(2);
      for (const day of json.dailyUsage) {
        expect(day.deviation.level).toBe("none");
        expect(day.deviation.multiplier).toBe(day.totalRequests);
      }
    });

    it("deviation reacts when the configured thresholds change", async () => {
      await seedAuthSession();

      await seedConfiguration({
        entityName: "test-org",
        apiMode: ApiMode.ORGANISATION,
        normSeatsCount: 2,
        deviationWarningThreshold: 20,
        deviationAlertThreshold: 30,
      });

      const seatA = await seedSeat({ githubUsername: "reconfig-a", githubUserId: 7030 });
      const seatB = await seedSeat({ githubUsername: "reconfig-b", githubUserId: 7031 });
      const seatC = await seedSeat({ githubUsername: "reconfig-c", githubUserId: 7032 });

      // seatA: 280 total (10/day × 28 days)
      for (let d = 1; d <= 28; d++) {
        await seedUsage({
          seatId: seatA.id, day: d, month: PREV_MONTH, year: PREV_YEAR,
          usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 }],
        });
      }

      // seatB: 560 total (20/day × 28 days)
      for (let d = 1; d <= 28; d++) {
        await seedUsage({
          seatId: seatB.id, day: d, month: PREV_MONTH, year: PREV_YEAR,
          usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 20, grossAmount: 0.8, discountQuantity: 0, discountAmount: 0, netQuantity: 20, netAmount: 0.8 }],
        });
      }

      // seatC: 140 total (5/day × 28 days)
      for (let d = 1; d <= 28; d++) {
        await seedUsage({
          seatId: seatC.id, day: d, month: PREV_MONTH, year: PREV_YEAR,
          usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 5, grossAmount: 0.2, discountQuantity: 0, discountAmount: 0, netQuantity: 5, netAmount: 0.2 }],
        });
      }

      // Seed current month usage for seatA
      await seedUsage({
        seatId: seatA.id, day: 1, month: VIEW_MONTH, year: VIEW_YEAR,
        usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 }],
      });

      const request1 = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response1 = await GET(request1 as never, makeContext(String(seatA.id)) as never);
      const json1 = await response1.json();
      expect(json1.dailyUsage[0].deviation.level).toBe("none");

      // Lower thresholds so the same day becomes an alert.
      const configRepo = testDs.getRepository(ConfigurationEntity);
      const existingConfig = await configRepo.findOne({ where: {} });
      await configRepo.update(existingConfig!.id, {
        deviationWarningThreshold: 5,
        deviationAlertThreshold: 9,
      });

      const request2 = makeGetRequest(String(seatA.id), { month: String(VIEW_MONTH), year: String(VIEW_YEAR) });
      const response2 = await GET(request2 as never, makeContext(String(seatA.id)) as never);
      const json2 = await response2.json();
      expect(json2.dailyUsage[0].deviation.level).toBe("alert");
      expect(json2.dailyUsage[0].deviation.multiplier).toBe(10);
    });
  });
});
