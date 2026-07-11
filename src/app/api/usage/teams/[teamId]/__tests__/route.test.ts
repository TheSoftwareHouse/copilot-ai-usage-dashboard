/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { TeamEntity, type Team } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity, type TeamMemberSnapshot } from "@/entities/team-member-snapshot.entity";
import { SeatStatus } from "@/entities/enums";
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

const { GET } = await import("@/app/api/usage/teams/[teamId]/route");
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

function makeGetRequest(teamId: string, params?: Record<string, string>): { request: NextRequest; context: { params: Promise<{ teamId: string }> } } {
  const url = new URL(`http://localhost:3000/api/usage/teams/${teamId}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return {
    request: new NextRequest(url.toString(), { method: "GET" }),
    context: { params: Promise.resolve({ teamId }) },
  };
}

async function seedTeam(name: string): Promise<Team> {
  const teamRepo = testDs.getRepository(TeamEntity);
  return teamRepo.save({ name } as Partial<Team>);
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

async function seedMemberSnapshot(
  overrides: Partial<TeamMemberSnapshot> & { teamId: number; seatId: number; month: number; year: number },
): Promise<TeamMemberSnapshot> {
  const repo = testDs.getRepository(TeamMemberSnapshotEntity);
  return repo.save({ allocationPercentage: 100, ...overrides } as Partial<TeamMemberSnapshot>);
}

async function seedUsage(
  overrides: Partial<CopilotUsage> & { seatId: number; day: number; month: number; year: number; usageItems: unknown[] },
): Promise<CopilotUsage> {
  const usageRepo = testDs.getRepository(CopilotUsageEntity);
  return usageRepo.save(overrides as Partial<CopilotUsage>);
}

describe("GET /api/usage/teams/[teamId]", () => {
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
    const { request, context } = makeGetRequest("1");
    const response = await GET(request as never, context);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid teamId", async () => {
    await seedAuthSession();

    const testCases = ["abc", "0", "-1", "1.5"];
    for (const id of testCases) {
      const { request, context } = makeGetRequest(id);
      const response = await GET(request as never, context);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid team ID");
    }
  });

  it("returns 404 for non-existent team", async () => {
    await seedAuthSession();

    const { request, context } = makeGetRequest("9999");
    const response = await GET(request as never, context);
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Team not found");
  });

  it("returns team detail with per-member usage breakdown", async () => {
    await seedAuthSession();

    const team = await seedTeam("Frontend Team");
    const seat1 = await seedSeat({ githubUsername: "alice", githubUserId: 1001, firstName: "Alice", lastName: "Smith" });
    const seat2 = await seedSeat({ githubUsername: "bob", githubUserId: 1002, firstName: "Bob", lastName: "Jones" });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026, allocationPercentage: 50 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.team.teamId).toBe(team.id);
    expect(json.team.teamName).toBe("Frontend Team");
    expect(json.team.memberCount).toBe(2);
    expect(json.team.totalRequests).toBe(100);
    expect(json.team.totalGrossAmount).toBeCloseTo(4.0, 2);
    expect(json.team.totalCost).toBeCloseTo(4.0, 2);
    expect(json.team.averageRequestsPerMember).toBe(50);
    expect(json.team.averageGrossAmountPerMember).toBeCloseTo(2.0, 2);

    expect(json.members).toHaveLength(2);
    expect(json.members[0].allocationPercentage).toBe(50);
    expect(json.members[0].allocatedRequests).toBe(50);
    expect(json.members[0].totalGrossAmount).toBeCloseTo(2.0, 2);
    expect(json.members[1].allocationPercentage).toBe(100);
    expect(json.members[1].allocatedRequests).toBe(50);
    expect(json.members[1].totalGrossAmount).toBeCloseTo(2.0, 2);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("members are ordered by totalRequests DESC", async () => {
    await seedAuthSession();

    const team = await seedTeam("Order Team");
    const seatLow = await seedSeat({ githubUsername: "low", githubUserId: 2001 });
    const seatHigh = await seedSeat({ githubUsername: "high", githubUserId: 2002 });

    await seedMemberSnapshot({ teamId: team.id, seatId: seatLow.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seatHigh.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seatLow.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seatHigh.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 200, grossAmount: 8.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.members[0].githubUsername).toBe("high");
    expect(json.members[1].githubUsername).toBe("low");
  });

  it("team with no members returns empty members array and zero aggregates", async () => {
    await seedAuthSession();

    const team = await seedTeam("Empty Team");

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.team.memberCount).toBe(0);
    expect(json.team.totalRequests).toBe(0);
    expect(json.team.totalGrossAmount).toBe(0);
    expect(json.team.averageRequestsPerMember).toBe(0);
    expect(json.members).toEqual([]);
    expect(json.dailyUsagePerMember).toEqual([]);
  });

  it("team with members but no usage data returns members with zero totals", async () => {
    await seedAuthSession();

    const team = await seedTeam("Idle Team");
    const seat = await seedSeat({ githubUsername: "idle", githubUserId: 3001 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat.id, month: 2, year: 2026 });

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.members).toHaveLength(1);
    expect(json.members[0].githubUsername).toBe("idle");
    expect(json.members[0].totalRequests).toBe(0);
    expect(json.members[0].totalGrossAmount).toBe(0);
  });

  it("keeps costStats raw when team allocations are below 100%", async () => {
    await seedAuthSession();

    const team = await seedTeam("Allocation Team");
    const seat1 = await seedSeat({ githubUsername: "alloc-low", githubUserId: 6001, firstName: "Alloc", lastName: "Low" });
    const seat2 = await seedSeat({ githubUsername: "alloc-high", githubUserId: 6002, firstName: "Alloc", lastName: "High" });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026, allocationPercentage: 50 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seat1.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4000, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2000, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.team.totalCost).toBe(4000);
    expect(json.costStats.totalCost).toBeCloseTo(1.5, 2);
    expect(json.costStats.averageDailyCost).toBeCloseTo(0.05, 2);
    expect(json.costStats.predictedMonthCost).toBeCloseTo(1, 2);
  });

  it("dailyUsagePerMember returned with daily breakdown per member", async () => {
    await seedAuthSession();

    const team = await seedTeam("Chart Team");
    const seat = await seedSeat({ githubUsername: "chart-user", githubUserId: 4001 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seat.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 25, grossAmount: 1.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat.id, day: 3, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 15, grossAmount: 0.6, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.dailyUsagePerMember).toHaveLength(1);
    const memberDaily = json.dailyUsagePerMember[0];
    expect(memberDaily.seatId).toBe(seat.id);
    expect(memberDaily.githubUsername).toBe("chart-user");
    expect(memberDaily.days).toHaveLength(2);
    expect(memberDaily.days[0]).toEqual({ day: 1, totalRequests: 25 });
    expect(memberDaily.days[1]).toEqual({ day: 3, totalRequests: 15 });
  });

  it("dailyUsagePerMember is empty array when team has no members", async () => {
    await seedAuthSession();

    const team = await seedTeam("No Members Team");

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.dailyUsagePerMember).toEqual([]);
  });

  it("defaults to current month/year when params are missing", async () => {
    await seedAuthSession();

    const team = await seedTeam("Default Month Team");
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const { request, context } = makeGetRequest(String(team.id));
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("team.usagePercent uses capped per-member requests", async () => {
    await seedAuthSession();

    const team = await seedTeam("Capped Detail Team");
    const seat1 = await seedSeat({ githubUsername: "heavy-user", githubUserId: 5001 });
    const seat2 = await seedSeat({ githubUsername: "light-user", githubUserId: 5002 });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });

    // seat1: 1000 requests (exceeds cap of 300)
    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 1000, grossAmount: 40.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(team.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    // team.usagePercent is capped: (min(1000,300) + min(100,300)) / (2 * 300) * 100 ≈ 66.67
    expect(json.team).not.toHaveProperty("usagePercent");
    // team.totalRequests stays uncapped when allocation is 100%
    expect(json.team.totalRequests).toBe(1100);
    // members expose both raw and allocated totals
    expect(json.members[0].totalRequests).toBe(1000);
    expect(json.members[0].allocatedRequests).toBe(1000);
    expect(json.members[1].totalRequests).toBe(100);
    expect(json.members[1].allocatedRequests).toBe(100);
  });
});
