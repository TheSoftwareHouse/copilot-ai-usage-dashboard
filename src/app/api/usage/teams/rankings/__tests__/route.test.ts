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

const { GET } = await import("@/app/api/usage/teams/rankings/route");
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
  const url = new URL("http://localhost:3000/api/usage/teams/rankings");
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

describe("GET /api/usage/teams/rankings", () => {
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

  it("returns empty mostActive and leastActive arrays when no teams have member data", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toEqual({
      mostActive: [],
      leastActive: [],
      month: 2,
      year: 2026,
    });
  });

  it("returns correct top teams ordered by usage percent descending", async () => {
    await seedAuthSession();

    // Legacy per-seat allowance removed; ranking is based on raw credit totals.
    // Team A: 2 members, seat1=300, seat2=150 → capped=300+150=450 → 450/(2×300)×100 = 75%
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1001 });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 1002 });
    const teamA = await seedTeam("Team A");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    // Team B: 1 member, seat3=120 → 120/300×100 = 40%
    const seat3 = await seedSeat({ githubUsername: "user3", githubUserId: 1003 });
    const teamB = await seedTeam("Team B");
    await seedMemberSnapshot({ teamId: teamB.id, seatId: seat3.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(120)] });

    // Team C: 1 member, seat4=270 → 270/300×100 = 90%
    const seat4 = await seedSeat({ githubUsername: "user4", githubUserId: 1004 });
    const teamC = await seedTeam("Team C");
    await seedMemberSnapshot({ teamId: teamC.id, seatId: seat4.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat4.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(270)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(3);
    // Ordered by raw gross credits: Team A (450), Team C (270), Team B (60)
    expect(json.mostActive[0].teamName).toBe("Team A");
    expect(json.mostActive[0].memberCount).toBe(2);
    expect(json.mostActive[0]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[0].totalAiCredits).toBe(450);

    expect(json.mostActive[1].teamName).toBe("Team C");
    expect(json.mostActive[1].memberCount).toBe(1);
    expect(json.mostActive[1]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[1].teamId).toBe(teamC.id);

    expect(json.mostActive[2].teamName).toBe("Team B");
    expect(json.mostActive[2].memberCount).toBe(1);
    expect(json.mostActive[2]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[2].totalAiCredits).toBe(120);

    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("returns correct bottom teams ordered by gross credits ascending", async () => {
    await seedAuthSession();

    // Team X: 1 member, 60 requests → 20%
    const seat1 = await seedSeat({ githubUsername: "low-user", githubUserId: 2001 });
    const teamX = await seedTeam("Team X");
    await seedMemberSnapshot({ teamId: teamX.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(60)] });

    // Team Y: 1 member, 240 requests → 80%
    const seat2 = await seedSeat({ githubUsername: "high-user", githubUserId: 2002 });
    const teamY = await seedTeam("Team Y");
    await seedMemberSnapshot({ teamId: teamY.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(240)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    // leastActive: Team X (20%) first, Team Y (80%) second
    expect(json.leastActive).toHaveLength(2);
    expect(json.leastActive[0].teamName).toBe("Team X");
    expect(json.leastActive[0]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[1].teamName).toBe("Team Y");
    expect(json.leastActive[1]).not.toHaveProperty("usagePercent");
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
    expect(json.mostActive).toEqual([]);
    expect(json.leastActive).toEqual([]);
  });

  it("returns fewer than 5 entries when fewer teams have data", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat({ githubUsername: "user-a", githubUserId: 3001 });
    const teamA = await seedTeam("Alpha");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(200)] });

    const seat2 = await seedSeat({ githubUsername: "user-b", githubUserId: 3002 });
    const teamB = await seedTeam("Bravo");
    await seedMemberSnapshot({ teamId: teamB.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(100)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(2);
    expect(json.mostActive[0].teamName).toBe("Alpha");
    expect(json.mostActive[1].teamName).toBe("Bravo");

    expect(json.leastActive).toHaveLength(2);
    expect(json.leastActive[0].teamName).toBe("Bravo");
    expect(json.leastActive[1].teamName).toBe("Alpha");
  });

  it("returns at most 5 entries per list when more than 5 teams have data", async () => {
    await seedAuthSession();

    // Create 7 teams with different usage amounts (all below cap of 300 to avoid ties)
    const quantities = [290, 250, 200, 150, 100, 60, 30];
    const teamNames = ["Team-0", "Team-1", "Team-2", "Team-3", "Team-4", "Team-5", "Team-6"];
    for (let i = 0; i < quantities.length; i++) {
      const seat = await seedSeat({ githubUsername: `user-${i}`, githubUserId: 4001 + i });
      const team = await seedTeam(teamNames[i]);
      await seedMemberSnapshot({ teamId: team.id, seatId: seat.id, month: 2, year: 2026 });
      await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(quantities[i])] });
    }

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(5);
    expect(json.mostActive[0].teamName).toBe("Team-0"); // 290 → 96.7%
    expect(json.mostActive[1].teamName).toBe("Team-1"); // 250 → 83.3%
    expect(json.mostActive[2].teamName).toBe("Team-2"); // 200 → 66.7%
    expect(json.mostActive[3].teamName).toBe("Team-3"); // 150 → 50%
    expect(json.mostActive[4].teamName).toBe("Team-4"); // 100 → 33.3%

    expect(json.leastActive).toHaveLength(5);
    expect(json.leastActive[0].teamName).toBe("Team-6"); // 30 → 10%
    expect(json.leastActive[1].teamName).toBe("Team-5"); // 60 → 20%
    expect(json.leastActive[2].teamName).toBe("Team-4"); // 100 → 33.3%
    expect(json.leastActive[3].teamName).toBe("Team-3"); // 150 → 50%
    expect(json.leastActive[4].teamName).toBe("Team-2"); // 200 → 66.7%
  });

  it("returns entries without legacy usagePercent fields", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat({ githubUsername: "user-x", githubUserId: 5001 });
    const teamA = await seedTeam("Team X");
    await seedMemberSnapshot({ teamId: teamA.id, seatId: seat1.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(200)] });

    const seat2 = await seedSeat({ githubUsername: "user-y", githubUserId: 5002 });
    const teamB = await seedTeam("Team Y");
    await seedMemberSnapshot({ teamId: teamB.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(100)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(2);
    expect(json.mostActive[0]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[1]).not.toHaveProperty("usagePercent");

    expect(json.leastActive).toHaveLength(2);
    expect(json.leastActive[0]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[1]).not.toHaveProperty("usagePercent");
  });

  it("includes teams whose members have zero actual usage in the rankings", async () => {
    await seedAuthSession();

    // Team with member snapshots but no copilot_usage records → 0% usage
    const seat1 = await seedSeat({ githubUsername: "idle-user", githubUserId: 6001 });
    const teamIdle = await seedTeam("Idle Team");
    await seedMemberSnapshot({ teamId: teamIdle.id, seatId: seat1.id, month: 2, year: 2026 });
    // No usage seeded for seat1

    // Team with actual usage → 50%
    const seat2 = await seedSeat({ githubUsername: "active-user", githubUserId: 6002 });
    const teamActive = await seedTeam("Active Team");
    await seedMemberSnapshot({ teamId: teamActive.id, seatId: seat2.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    // Both teams should appear
    expect(json.mostActive).toHaveLength(2);
    expect(json.mostActive[0].teamName).toBe("Active Team");
    expect(json.mostActive[0]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[1].teamName).toBe("Idle Team");
    expect(json.mostActive[1]).not.toHaveProperty("usagePercent");

    expect(json.leastActive).toHaveLength(2);
    expect(json.leastActive[0].teamName).toBe("Idle Team");
    expect(json.leastActive[0]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[1].teamName).toBe("Active Team");
  });

  it("excludes teams with no member snapshots from rankings", async () => {
    await seedAuthSession();

    // Team with no member snapshots (defined in team table but no entries in team_member_snapshot)
    await seedTeam("Empty Team");

    // Team with member and usage → should be the only one in rankings
    const seat = await seedSeat({ githubUsername: "solo-user", githubUserId: 7001 });
    const teamSolo = await seedTeam("Solo Team");
    await seedMemberSnapshot({ teamId: teamSolo.id, seatId: seat.id, month: 2, year: 2026 });
    await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(1);
    expect(json.mostActive[0].teamName).toBe("Solo Team");

    expect(json.leastActive).toHaveLength(1);
    expect(json.leastActive[0].teamName).toBe("Solo Team");
  });
});
