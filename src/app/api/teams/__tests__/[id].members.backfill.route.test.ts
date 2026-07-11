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

const { POST } = await import(
  "@/app/api/teams/[id]/members/backfill/route"
);
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import(
  "@/lib/auth"
);
const { TeamEntity } = await import("@/entities/team.entity");
const { TeamMemberSnapshotEntity } = await import(
  "@/entities/team-member-snapshot.entity"
);
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

async function createTeam(name: string, deletedAt?: Date): Promise<Team> {
  const teamRepo = testDs.getRepository(TeamEntity);
  return teamRepo.save({
    name,
    deletedAt: deletedAt ?? null,
  } as Partial<Team>);
}

async function createSeat(
  githubUsername: string,
  githubUserId: number,
  status: SeatStatus = SeatStatus.ACTIVE,
): Promise<CopilotSeat> {
  const seatRepo = testDs.getRepository(CopilotSeatEntity);
  return seatRepo.save({
    githubUsername,
    githubUserId,
    status,
  } as Partial<CopilotSeat>);
}

function makePostRequest(
  id: number | string,
  body?: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  const request = new Request(
    `http://localhost:3000/api/teams/${id}/members/backfill`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
  return [request, { params: Promise.resolve({ id: String(id) }) }];
}

// Use a date range that is safely in the past
const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

// Pick a safe start: January of last year
const pastStartMonth = 1;
const pastStartYear = currentYear - 1;
// Pick a safe end: March of last year
const pastEndMonth = 3;
const pastEndYear = currentYear - 1;

// ───── POST /api/teams/[id]/members/backfill ─────

describe("POST /api/teams/[id]/members/backfill", () => {
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

  // ── Auth & ID ──

  it("returns 401 without session", async () => {
    const [req, ctx] = makePostRequest(1, {
      seatIds: [1],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const [req, ctx] = makePostRequest(1, {
      seatIds: [1],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 400 for invalid team ID", async () => {
    await seedAuthSession();
    const [req, ctx] = makePostRequest("abc", {
      seatIds: [1],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid team ID");
  });

  it("returns 400 for malformed JSON", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const request = new Request(
      `http://localhost:3000/api/teams/${team.id}/members/backfill`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      },
    );
    const ctx = { params: Promise.resolve({ id: String(team.id) }) };
    const response = await POST(request, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid JSON body");
  });

  // ── Validation ──

  it("returns 400 for empty seatIds", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Validation failed");
  });

  it("returns 400 when start is after end", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [1],
      startMonth: pastEndMonth,
      startYear: pastEndYear,
      endMonth: pastStartMonth,
      endYear: pastStartYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Validation failed");
  });

  it("returns 400 when required fields are missing", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [1],
      // missing startMonth, startYear, endMonth, endYear
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Validation failed");
  });

  it("returns 400 when end date is in the future", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const futureMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const futureYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [1],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: futureMonth,
      endYear: futureYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Validation failed");
  });

  // ── Team / Seat existence ──

  it("returns 404 for non-existent team", async () => {
    await seedAuthSession();
    const [req, ctx] = makePostRequest(9999, {
      seatIds: [1],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Team not found");
  });

  it("returns 404 for soft-deleted team", async () => {
    await seedAuthSession();
    const team = await createTeam("Deleted", new Date());
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [1],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(404);
  });

  it("returns 400 for non-existent seatIds", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("existing", 5001);
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id, 99999],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Some seat IDs do not exist");
    expect(json.invalidSeatIds).toContain(99999);
  });

  // ── Successful backfill ──

  it("backfills single seat across 3-month range", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(3);
    expect(json.totalMonthsInRange).toBe(3);
    expect(json.startMonth).toBe(pastStartMonth);
    expect(json.startYear).toBe(pastStartYear);
    expect(json.endMonth).toBe(pastEndMonth);
    expect(json.endYear).toBe(pastEndYear);

    // Verify snapshots in DB
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat.id },
      order: { year: "ASC", month: "ASC" },
    });
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].month).toBe(1);
    expect(snapshots[1].month).toBe(2);
    expect(snapshots[2].month).toBe(3);
    expect(snapshots.every((snapshot) => snapshot.allocationPercentage === 100)).toBe(true);
  });

  it("backfills multiple seats across range", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat1 = await createSeat("user1", 5001);
    const seat2 = await createSeat("user2", 5002);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat1.id, seat2.id],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(6); // 2 seats × 3 months
    expect(json.totalMonthsInRange).toBe(3);
  });

  it("backfills single month when start equals end", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastStartMonth,
      endYear: pastStartYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(1);
    expect(json.totalMonthsInRange).toBe(1);
  });

  // ── Idempotency ──

  it("ignores duplicates — returns added=0 when all exist", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    // Pre-seed the exact snapshots
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: 1, year: pastStartYear },
      { teamId: team.id, seatId: seat.id, month: 2, year: pastStartYear },
      { teamId: team.id, seatId: seat.id, month: 3, year: pastStartYear },
    ]);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(0);

    // Still only 3 snapshots
    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat.id },
    });
    expect(snapshots).toHaveLength(3);
  });

  it("adds only missing months when some already exist", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    // Pre-seed month 2 only
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save({
      teamId: team.id,
      seatId: seat.id,
      month: 2,
      year: pastStartYear,
    });

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastEndMonth,
      endYear: pastEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(2); // months 1 and 3 are new

    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat.id },
    });
    expect(snapshots).toHaveLength(3);
  });

  // ── Cross-year range ──

  it("handles cross-year range correctly", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    // Nov last year → Feb this year would be 4 months but might be future
    // Use Nov-Dec of two years ago → Jan of last year (safe past range)
    const crossStartMonth = 11;
    const crossStartYear = currentYear - 2;
    const crossEndMonth = 1;
    const crossEndYear = currentYear - 1;

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      startMonth: crossStartMonth,
      startYear: crossStartYear,
      endMonth: crossEndMonth,
      endYear: crossEndYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(3); // Nov, Dec, Jan
    expect(json.totalMonthsInRange).toBe(3);

    // Verify months
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat.id },
      order: { year: "ASC", month: "ASC" },
    });
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toMatchObject({ month: 11, year: crossStartYear });
    expect(snapshots[1]).toMatchObject({ month: 12, year: crossStartYear });
    expect(snapshots[2]).toMatchObject({ month: 1, year: crossEndYear });
  });

  // ── Isolation ──

  it("does not affect other teams' snapshots", async () => {
    await seedAuthSession();
    const team1 = await createTeam("Team1");
    const team2 = await createTeam("Team2");
    const seat = await createSeat("user1", 5001);

    // Seed snapshot for team2
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save({
      teamId: team2.id,
      seatId: seat.id,
      month: pastStartMonth,
      year: pastStartYear,
    });

    // Backfill team1
    const [req, ctx] = makePostRequest(team1.id, {
      seatIds: [seat.id],
      startMonth: pastStartMonth,
      startYear: pastStartYear,
      endMonth: pastStartMonth,
      endYear: pastStartYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    expect((await response.json()).added).toBe(1);

    // Team2 snapshot still exists
    const team2Snapshots = await snapshotRepo.find({
      where: { teamId: team2.id },
    });
    expect(team2Snapshots).toHaveLength(1);
  });

  // ── Backfill up to current month ──

  it("allows backfill up to current month", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      startMonth: currentMonth,
      startYear: currentYear,
      endMonth: currentMonth,
      endYear: currentYear,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(1);
    expect(json.totalMonthsInRange).toBe(1);
  });
});
