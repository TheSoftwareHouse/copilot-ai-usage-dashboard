/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import type { Team } from "@/entities/team.entity";
import type { CopilotSeat } from "@/entities/copilot-seat.entity";
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

const { PATCH } = await import("@/app/api/teams/[id]/members/[seatId]/allocation/route");
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import("@/lib/auth");
const { TeamEntity } = await import("@/entities/team.entity");
const { TeamMemberSnapshotEntity } = await import("@/entities/team-member-snapshot.entity");
const { CopilotSeatEntity } = await import("@/entities/copilot-seat.entity");

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

async function createTeam(name: string): Promise<Team> {
  const teamRepo = testDs.getRepository(TeamEntity);
  return teamRepo.save({ name, deletedAt: null } as Partial<Team>);
}

async function createSeat(githubUsername: string, githubUserId: number): Promise<CopilotSeat> {
  const seatRepo = testDs.getRepository(CopilotSeatEntity);
  return seatRepo.save({
    githubUsername,
    githubUserId,
    status: SeatStatus.ACTIVE,
  } as Partial<CopilotSeat>);
}

function makePatchRequest(
  teamId: number | string,
  seatId: number | string,
  body: unknown,
): [Request, { params: Promise<{ id: string; seatId: string }> }] {
  const request = new Request(
    `http://localhost:3000/api/teams/${teamId}/members/${seatId}/allocation`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return [
    request,
    { params: Promise.resolve({ id: String(teamId), seatId: String(seatId) }) },
  ];
}

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

describe("PATCH /api/teams/[id]/members/[seatId]/allocation", () => {
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
    const [req, ctx] = makePatchRequest(1, 1, { month: currentMonth, year: currentYear, allocationPercentage: 80 });
    const response = await PATCH(req, ctx);
    expect(response.status).toBe(401);
  });

  it("updates allocation for a selected month and reports warning totals", async () => {
    await seedAuthSession();
    const team = await createTeam("Team A");
    const otherTeam = await createTeam("Team B");
    const seat = await createSeat("user-1", 1001);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear, allocationPercentage: 40 },
      { teamId: otherTeam.id, seatId: seat.id, month: currentMonth, year: currentYear, allocationPercentage: 50 },
    ]);

    const [req, ctx] = makePatchRequest(team.id, seat.id, {
      month: currentMonth,
      year: currentYear,
      allocationPercentage: 75,
    });
    const response = await PATCH(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allocationPercentage).toBe(75);
    expect(json.allocationWarning).toBeDefined();
    expect(json.allocationWarning.totalAllocationPercentage).toBe(125);

    const updated = await snapshotRepo.findOne({
      where: { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear },
    });
    expect(updated?.allocationPercentage).toBe(75);
  });

  it("returns no warning when updated allocation keeps the seat at or under 100 percent", async () => {
    await seedAuthSession();
    const team = await createTeam("Team A");
    const otherTeam = await createTeam("Team B");
    const seat = await createSeat("user-2", 1002);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear, allocationPercentage: 40 },
      { teamId: otherTeam.id, seatId: seat.id, month: currentMonth, year: currentYear, allocationPercentage: 20 },
    ]);

    const [req, ctx] = makePatchRequest(team.id, seat.id, {
      month: currentMonth,
      year: currentYear,
      allocationPercentage: 80,
    });
    const response = await PATCH(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allocationPercentage).toBe(80);
    expect(json.allocationWarning).toBeNull();
  });
});
