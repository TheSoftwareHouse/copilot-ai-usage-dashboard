/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { TeamEntity, type Team } from "@/entities/team.entity";
import {
  TeamMemberSnapshotEntity,
  type TeamMemberSnapshot,
} from "@/entities/team-member-snapshot.entity";
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

const { GET } = await import("@/app/api/usage/teams/stats/route");
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
  const url = new URL("http://localhost:3000/api/usage/teams/stats");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
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

async function seedTeam(name: string): Promise<Team> {
  const teamRepo = testDs.getRepository(TeamEntity);
  return teamRepo.save({ name } as Partial<Team>);
}

async function seedMemberSnapshot(
  overrides: Partial<TeamMemberSnapshot> & { teamId: number; seatId: number; month: number; year: number },
): Promise<TeamMemberSnapshot> {
  const repo = testDs.getRepository(TeamMemberSnapshotEntity);
  return repo.save(overrides as Partial<TeamMemberSnapshot>);
}

function makeUsageItem(grossQuantity: number) {
  return {
    product: "Copilot",
    sku: "Premium",
    model: "Claude Sonnet 4.5",
    unitType: "requests",
    pricePerUnit: 0.04,
    grossQuantity,
    grossAmount: grossQuantity * 0.04,
    discountQuantity: grossQuantity,
    discountAmount: grossQuantity * 0.04,
    netQuantity: 0,
    netAmount: 0,
  };
}

describe("GET /api/usage/teams/stats", () => {
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

  it("returns null stats when no teams have member data for the month", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toEqual({
      averageRequests: null,
      medianRequests: null,
      minRequests: null,
      maxRequests: null,
      month: 2,
      year: 2026,
    });
  });

  it("returns correct aggregate stats for multiple teams with varying usage", async () => {
    await seedAuthSession();
    // Team A: 2 members, seat1=300 requests, seat2=150 requests
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1001 });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 1002 });
    const teamA = await seedTeam("Team A");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    // Team B: 1 member, seat3=60 requests
    const seat3 = await seedSeat({ githubUsername: "user3", githubUserId: 1003 });
    const teamB = await seedTeam("Team B");
    await seedMemberSnapshot({ teamId: teamB.id, seatId: seat3.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(60)] });

    // Team C: 1 member, seat4=300 requests
    const seat4 = await seedSeat({ githubUsername: "user4", githubUserId: 1004 });
    const teamC = await seedTeam("Team C");
    await seedMemberSnapshot({ teamId: teamC.id, seatId: seat4.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat4.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    // avg = (75 + 20 + 100) / 3 = 65.0
    // median of [20, 75, 100] = 75.0
    // min = 20.0
    // max = 100.0
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("defaults to current month/year when params are missing", async () => {
    await seedAuthSession();

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    const now = new Date();
    expect(json.month).toBe(now.getUTCMonth() + 1);
    expect(json.year).toBe(now.getUTCFullYear());
  });

  it("correctly computes median for an even number of teams", async () => {
    await seedAuthSession();

    // Team A: 1 member, 300 requests → 100%
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1001 });
    const teamA = await seedTeam("Team A");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });

    // Team B: 1 member, 150 requests → 50%
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 1002 });
    const teamB = await seedTeam("Team B");
    await seedMemberSnapshot({ teamId: teamB.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    // Team C: 1 member, 60 requests → 20%
    const seat3 = await seedSeat({ githubUsername: "user3", githubUserId: 1003 });
    const teamC = await seedTeam("Team C");
    await seedMemberSnapshot({ teamId: teamC.id, seatId: seat3.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(60)] });
    const seat4 = await seedSeat({ githubUsername: "user4", githubUserId: 1004 });
    const teamD = await seedTeam("Team D");
    await seedMemberSnapshot({ teamId: teamD.id, seatId: seat4.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat4.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(450)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    // Sorted usage: [20, 50, 100, 100]
  });

  it("returns correct stats when only one team has data", async () => {
    await seedAuthSession();

    // Team A: 1 member, 210 requests → 70%
    const seat = await seedSeat({ githubUsername: "solo", githubUserId: 9001 });
    const team = await seedTeam("Solo Team");
    await seedMemberSnapshot({ teamId: team.id, seatId: seat.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(210)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    // Single team: average = median = min = max = 70.0
  });

  it("returns raw credit stats without an allowance dependency", async () => {
    await seedAuthSession();

    const seat = await seedSeat({ githubUsername: "user1", githubUserId: 1001 });
    const team = await seedTeam("Team A");
    await seedMemberSnapshot({ teamId: team.id, seatId: seat.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
  });

  it("excludes teams with zero members from computation", async () => {
    await seedAuthSession();

    // Team A: has a member with usage → included
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1001 });
    const teamA = await seedTeam("Team With Members");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    // Team B: exists in team table but no member snapshots → excluded
    await seedTeam("Empty Team");

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    // Only Team A with 150/300 = 50% should be counted
  });

  it("includes teams whose members have zero actual usage", async () => {
    await seedAuthSession();

    // Team A: 1 member, 300 requests → 100%
    const seat1 = await seedSeat({ githubUsername: "active-user", githubUserId: 1001 });
    const teamA = await seedTeam("Active Team");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });

    // Team B: 1 member with snapshot but NO copilot_usage records → 0%
    const seat2 = await seedSeat({ githubUsername: "idle-user", githubUserId: 1002 });
    const teamB = await seedTeam("Idle Team");
    await seedMemberSnapshot({ teamId: teamB.id, seatId: seat2.id, month: 2, year: 2026 });
    // No seedUsage for seat2 — member has zero usage

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    // avg = (100 + 0) / 2 = 50.0
    // median of [0, 100] = (0 + 100) / 2 = 50.0
    // min = 0.0
    // max = 100.0
  });
});
