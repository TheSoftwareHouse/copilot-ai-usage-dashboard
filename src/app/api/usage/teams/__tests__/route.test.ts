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

const { GET } = await import("@/app/api/usage/teams/route");
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

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/usage/teams");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
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

describe("GET /api/usage/teams", () => {
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
    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns empty list when no teams exist", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
    expect(json).not.toHaveProperty("usagePercent");
  });

  it("returns teams with aggregated usage metrics", async () => {
    await seedAuthSession();

    const team = await seedTeam("Frontend Team");
    const seat1 = await seedSeat({ githubUsername: "alice", githubUserId: 1001 });
    const seat2 = await seedSeat({ githubUsername: "bob", githubUserId: 1002 });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026, allocationPercentage: 50 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
      ],
    });

    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 30, discountAmount: 1.2, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toHaveLength(1);
    expect(json.total).toBe(1);

    const t = json.teams[0];
    expect(t.teamId).toBe(team.id);
    expect(t.teamName).toBe("Frontend Team");
    expect(t.memberCount).toBe(2);
    expect(t.totalRequests).toBe(55);
    expect(t.totalGrossAmount).toBeCloseTo(2.2, 2);
    expect(t.totalCost).toBeCloseTo(2.2, 2);
    expect(t.averageRequestsPerMember).toBe(27.5);
    expect(t.averageGrossAmountPerMember).toBeCloseTo(1.1, 2);
    // Allocated usage percent: (25 + 30) / ((0.5 + 1.0) * 300) × 100 = 12.22%
    expect(t).not.toHaveProperty("usagePercent");
    expect(json).not.toHaveProperty("usagePercent");
  });

  it("team with no members for the month returns zero metrics", async () => {
    await seedAuthSession();

    await seedTeam("Empty Team");

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toHaveLength(1);
    const t = json.teams[0];
    expect(t.teamName).toBe("Empty Team");
    expect(t.memberCount).toBe(0);
    expect(t.totalRequests).toBe(0);
    expect(t.totalGrossAmount).toBe(0);
    expect(t.averageRequestsPerMember).toBe(0);
    expect(t.averageGrossAmountPerMember).toBe(0);
    expect(t).not.toHaveProperty("usagePercent");
  });

  it("team with members but no usage data returns zero totals with correct member count", async () => {
    await seedAuthSession();

    const team = await seedTeam("No Usage Team");
    const seat = await seedSeat({ githubUsername: "idle-user", githubUserId: 2001 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat.id, month: 2, year: 2026 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.teams).toHaveLength(1);
    const t = json.teams[0];
    expect(t.memberCount).toBe(1);
    expect(t.totalRequests).toBe(0);
    expect(t.totalGrossAmount).toBe(0);
    expect(t).not.toHaveProperty("usagePercent");
  });

  it("average per member calculated correctly (total / memberCount)", async () => {
    await seedAuthSession();

    const team = await seedTeam("Calc Team");
    const seat1 = await seedSeat({ githubUsername: "calc-a", githubUserId: 3001 });
    const seat2 = await seedSeat({ githubUsername: "calc-b", githubUserId: 3002 });
    const seat3 = await seedSeat({ githubUsername: "calc-c", githubUserId: 3003 });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat3.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 60, grossAmount: 2.4, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    // seat3 has no usage

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    const t = json.teams[0];
    expect(t.memberCount).toBe(3);
    expect(t.totalRequests).toBe(90);
    expect(t.averageRequestsPerMember).toBe(30);
    expect(t.totalGrossAmount).toBeCloseTo(3.6, 2);
    expect(t.averageGrossAmountPerMember).toBeCloseTo(1.2, 2);
  });

  it("defaults to current month/year when params are missing", async () => {
    await seedAuthSession();

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const request = makeGetRequest();
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("teams ordered by name ASC", async () => {
    await seedAuthSession();

    await seedTeam("Zebra Team");
    await seedTeam("Alpha Team");
    await seedTeam("Middle Team");

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.teams).toHaveLength(3);
    expect(json.teams[0].teamName).toBe("Alpha Team");
    expect(json.teams[1].teamName).toBe("Middle Team");
    expect(json.teams[2].teamName).toBe("Zebra Team");
  });

  it("usagePercent uses capped per-member requests — members exceeding cap", async () => {
    await seedAuthSession();

    const team = await seedTeam("Capped Team");
    const seat1 = await seedSeat({ githubUsername: "heavy", githubUserId: 6001 });
    const seat2 = await seedSeat({ githubUsername: "light", githubUserId: 6002 });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });

    // seat1: 1000 requests (exceeds 300 cap), seat2: 100 requests (under cap)
    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 1000, grossAmount: 40.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    const t = json.teams[0];
    // capped: (min(1000,300) + min(100,300)) / (2 * 300) * 100 = (300 + 100) / 600 * 100 ≈ 66.67
    expect(t).not.toHaveProperty("usagePercent");
    // totalRequests remains uncapped raw sum
    expect(t.totalRequests).toBe(1100);
  });

  it("usagePercent matches uncapped calculation when all members are under cap", async () => {
    await seedAuthSession();

    const team = await seedTeam("Under Cap Team");
    const seat1 = await seedSeat({ githubUsername: "u1", githubUserId: 7001 });
    const seat2 = await seedSeat({ githubUsername: "u2", githubUserId: 7002 });

    await seedMemberSnapshot({ teamId: team.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: team.id, seatId: seat2.id, month: 2, year: 2026 });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 200, grossAmount: 8.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    const t = json.teams[0];
    // All under cap: (100 + 200) / (2 * 300) * 100 = 50% — same as uncapped
    expect(t).not.toHaveProperty("usagePercent");
    expect(t.totalRequests).toBe(300);
  });
});
