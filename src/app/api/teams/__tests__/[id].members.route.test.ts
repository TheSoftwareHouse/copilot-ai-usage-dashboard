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

const { GET, POST, DELETE } = await import(
  "@/app/api/teams/[id]/members/route"
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

function makeGetRequest(
  id: number | string,
): [Request, { params: Promise<{ id: string }> }] {
  const request = new Request(
    `http://localhost:3000/api/teams/${id}/members`,
    { method: "GET" },
  );
  return [request, { params: Promise.resolve({ id: String(id) }) }];
}

function makePostRequest(
  id: number | string,
  body?: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? { month: currentMonth, year: currentYear, ...(body as Record<string, unknown>) }
      : body;
  const request = new Request(
    `http://localhost:3000/api/teams/${id}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    },
  );
  return [request, { params: Promise.resolve({ id: String(id) }) }];
}

function makeDeleteRequest(
  id: number | string,
  body?: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? { month: currentMonth, year: currentYear, ...(body as Record<string, unknown>) }
      : body;
  const request = new Request(
    `http://localhost:3000/api/teams/${id}/members`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    },
  );
  return [request, { params: Promise.resolve({ id: String(id) }) }];
}

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

// ───── GET /api/teams/[id]/members ─────

describe("GET /api/teams/[id]/members", () => {
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
    const [req, ctx] = makeGetRequest(1);
    const response = await GET(req, ctx);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const [req, ctx] = makeGetRequest(1);
    const response = await GET(req, ctx);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 400 for invalid ID", async () => {
    await seedAuthSession();
    const [req, ctx] = makeGetRequest("abc");
    const response = await GET(req, ctx);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid team ID");
  });

  it("returns 404 for non-existent team", async () => {
    await seedAuthSession();
    const [req, ctx] = makeGetRequest(9999);
    const response = await GET(req, ctx);
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Team not found");
  });

  it("returns 404 for soft-deleted team", async () => {
    await seedAuthSession();
    const team = await createTeam("Deleted", new Date());
    const [req, ctx] = makeGetRequest(team.id);
    const response = await GET(req, ctx);
    expect(response.status).toBe(404);
  });

  it("returns empty members for team with no assignments", async () => {
    await seedAuthSession();
    const team = await createTeam("Empty Team");
    const [req, ctx] = makeGetRequest(team.id);
    const response = await GET(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.members).toEqual([]);
    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("returns members with seat details ordered by username", async () => {
    await seedAuthSession();
    const team = await createTeam("Dev Team");
    const seatB = await createSeat("buser", 2001);
    const seatA = await createSeat("auser", 2002);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seatB.id, month: currentMonth, year: currentYear, allocationPercentage: 100 },
      { teamId: team.id, seatId: seatA.id, month: currentMonth, year: currentYear, allocationPercentage: 60 },
    ]);

    const [req, ctx] = makeGetRequest(team.id);
    const response = await GET(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.members).toHaveLength(2);
    expect(json.members[0].githubUsername).toBe("auser");
    expect(json.members[1].githubUsername).toBe("buser");
    expect(json.members[0].seatId).toBe(seatA.id);
    expect(json.members[0]).toHaveProperty("firstName");
    expect(json.members[0]).toHaveProperty("lastName");
    expect(json.members[0]).toHaveProperty("status");
    expect(json.members[0].allocationPercentage).toBe(60);
    expect(json.members[1].allocationPercentage).toBe(100);
  });
});

// ───── POST /api/teams/[id]/members ─────

describe("POST /api/teams/[id]/members", () => {
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
    const [req, ctx] = makePostRequest(1, { seatIds: [1] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const [req, ctx] = makePostRequest(1, { seatIds: [1] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 400 for invalid team ID", async () => {
    await seedAuthSession();
    const [req, ctx] = makePostRequest("abc", { seatIds: [1] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid team ID");
  });

  it("returns 400 for empty seatIds", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const [req, ctx] = makePostRequest(team.id, { seatIds: [] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 for non-integer seatIds", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const [req, ctx] = makePostRequest(team.id, { seatIds: ["a"] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const request = new Request(
      `http://localhost:3000/api/teams/${team.id}/members`,
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

  it("returns 404 for non-existent team", async () => {
    await seedAuthSession();
    const [req, ctx] = makePostRequest(9999, { seatIds: [1] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(404);
  });

  it("returns 404 for soft-deleted team", async () => {
    await seedAuthSession();
    const team = await createTeam("Deleted", new Date());
    const [req, ctx] = makePostRequest(team.id, { seatIds: [1] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(404);
  });

  it("returns 400 for non-existent seatIds", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("existing", 3001);
    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id, 99999],
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.invalidSeatIds).toContain(99999);
  });

  it("adds seats successfully", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat1 = await createSeat("user1", 3001);
    const seat2 = await createSeat("user2", 3002);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat1.id, seat2.id],
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(2);
    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);

    // Verify snapshots exist
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, month: currentMonth, year: currentYear },
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((snapshot) => snapshot.allocationPercentage === 100)).toBe(true);
  });

  it("applies a custom allocation percentage to all added snapshots", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 3001);

    const [req, ctx] = makePostRequest(team.id, {
      seatIds: [seat.id],
      allocationPercentage: 60,
    });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.allocationPercentage).toBe(60);
    expect(json.allocationWarnings).toEqual([]);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const snapshot = await snapshotRepo.findOne({
      where: { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear },
    });
    expect(snapshot?.allocationPercentage).toBe(60);
  });

  it("ignores duplicate assignments (idempotent)", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 3001);

    // First add
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save({
      teamId: team.id,
      seatId: seat.id,
      month: currentMonth,
      year: currentYear,
    });

    // Try adding again
    const [req, ctx] = makePostRequest(team.id, { seatIds: [seat.id] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.added).toBe(0);

    // Still only one snapshot
    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, month: currentMonth, year: currentYear },
    });
    expect(snapshots).toHaveLength(1);
  });

  it("does not affect other months' snapshots", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 3001);

    // Create snapshot for previous month
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save({
      teamId: team.id,
      seatId: seat.id,
      month: prevMonth,
      year: prevYear,
    });

    // Add to current month
    const [req, ctx] = makePostRequest(team.id, { seatIds: [seat.id] });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);

    // Both snapshots exist
    const allSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat.id },
    });
    expect(allSnapshots).toHaveLength(2);
  });
});

// ───── DELETE /api/teams/[id]/members ─────

describe("DELETE /api/teams/[id]/members", () => {
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
    const [req, ctx] = makeDeleteRequest(1, { seatIds: [1] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const [req, ctx] = makeDeleteRequest(1, { seatIds: [1] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 400 for invalid team ID", async () => {
    await seedAuthSession();
    const [req, ctx] = makeDeleteRequest("abc", { seatIds: [1] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid team ID");
  });

  it("returns 400 for invalid body", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const [req, ctx] = makeDeleteRequest(team.id, { seatIds: [] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const request = new Request(
      `http://localhost:3000/api/teams/${team.id}/members`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      },
    );
    const ctx = { params: Promise.resolve({ id: String(team.id) }) };
    const response = await DELETE(request, ctx);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid JSON body");
  });

  it("returns 404 for non-existent team", async () => {
    await seedAuthSession();
    const [req, ctx] = makeDeleteRequest(9999, { seatIds: [1] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(404);
  });

  it("returns 404 for soft-deleted team", async () => {
    await seedAuthSession();
    const team = await createTeam("Deleted", new Date());
    const [req, ctx] = makeDeleteRequest(team.id, { seatIds: [1] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(404);
  });

  it("removes seats successfully", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat1 = await createSeat("user1", 4001);
    const seat2 = await createSeat("user2", 4002);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat1.id, month: currentMonth, year: currentYear },
      { teamId: team.id, seatId: seat2.id, month: currentMonth, year: currentYear },
    ]);

    const [req, ctx] = makeDeleteRequest(team.id, { seatIds: [seat1.id] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(1);

    const remaining = await snapshotRepo.find({
      where: { teamId: team.id, month: currentMonth, year: currentYear },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].seatId).toBe(seat2.id);
  });

  it("removing non-member seat succeeds silently (idempotent)", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 4001);

    const [req, ctx] = makeDeleteRequest(team.id, { seatIds: [seat.id] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(0);
  });

  it("does not affect historical snapshots (previous months)", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 4001);

    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: prevMonth, year: prevYear },
      { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear },
    ]);

    const [req, ctx] = makeDeleteRequest(team.id, { seatIds: [seat.id] });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(1);

    // Historical snapshot should remain
    const historicalSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month: prevMonth, year: prevYear },
    });
    expect(historicalSnapshots).toHaveLength(1);

    // Current month snapshot should be gone
    const currentSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month: currentMonth, year: currentYear },
    });
    expect(currentSnapshots).toHaveLength(0);
  });
});

// ───── DELETE /api/teams/[id]/members (purge mode) ─────

describe("DELETE /api/teams/[id]/members (purge mode)", () => {
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

  it("purge removes snapshots from ALL months", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: prevMonth, year: prevYear },
      { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear },
      { teamId: team.id, seatId: seat.id, month: 1, year: 2024 },
    ]);

    const [req, ctx] = makeDeleteRequest(team.id, {
      seatIds: [seat.id],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(3);
    expect(json.mode).toBe("purge");

    const remaining = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat.id },
    });
    expect(remaining).toHaveLength(0);
  });

  it("purge returns total count of removed snapshots across all months", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: 1, year: 2024 },
      { teamId: team.id, seatId: seat.id, month: 2, year: 2024 },
      { teamId: team.id, seatId: seat.id, month: 3, year: 2024 },
      { teamId: team.id, seatId: seat.id, month: 4, year: 2024 },
      { teamId: team.id, seatId: seat.id, month: 5, year: 2024 },
    ]);

    const [req, ctx] = makeDeleteRequest(team.id, {
      seatIds: [seat.id],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    const json = await response.json();
    expect(json.removed).toBe(5);
    expect(json.mode).toBe("purge");
  });

  it("purge with non-existent team returns 404", async () => {
    await seedAuthSession();
    const [req, ctx] = makeDeleteRequest(9999, {
      seatIds: [1],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(404);
  });

  it("purge with soft-deleted team returns 404", async () => {
    await seedAuthSession();
    const team = await createTeam("Deleted", new Date());
    const [req, ctx] = makeDeleteRequest(team.id, {
      seatIds: [1],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(404);
  });

  it("purge does not affect other teams' snapshots for the same seat", async () => {
    await seedAuthSession();
    const teamA = await createTeam("Team A");
    const teamB = await createTeam("Team B");
    const seat = await createSeat("user1", 5001);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: teamA.id, seatId: seat.id, month: currentMonth, year: currentYear },
      { teamId: teamA.id, seatId: seat.id, month: 1, year: 2024 },
      { teamId: teamB.id, seatId: seat.id, month: currentMonth, year: currentYear },
      { teamId: teamB.id, seatId: seat.id, month: 1, year: 2024 },
    ]);

    const [req, ctx] = makeDeleteRequest(teamA.id, {
      seatIds: [seat.id],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    const json = await response.json();
    expect(json.removed).toBe(2);

    // Team B snapshots should remain
    const teamBSnapshots = await snapshotRepo.find({
      where: { teamId: teamB.id },
    });
    expect(teamBSnapshots).toHaveLength(2);
  });

  it("purge does not affect other seats' snapshots in the same team", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat1 = await createSeat("user1", 5001);
    const seat2 = await createSeat("user2", 5002);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat1.id, month: currentMonth, year: currentYear },
      { teamId: team.id, seatId: seat1.id, month: 1, year: 2024 },
      { teamId: team.id, seatId: seat2.id, month: currentMonth, year: currentYear },
      { teamId: team.id, seatId: seat2.id, month: 1, year: 2024 },
    ]);

    const [req, ctx] = makeDeleteRequest(team.id, {
      seatIds: [seat1.id],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    const json = await response.json();
    expect(json.removed).toBe(2);

    // seat2 snapshots should remain
    const seat2Snapshots = await snapshotRepo.find({
      where: { teamId: team.id, seatId: seat2.id },
    });
    expect(seat2Snapshots).toHaveLength(2);
  });

  it("purge with seat that has no snapshots succeeds with removed: 0", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const [req, ctx] = makeDeleteRequest(team.id, {
      seatIds: [seat.id],
      mode: "purge",
    });
    const response = await DELETE(req, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(0);
    expect(json.mode).toBe("purge");
  });

  it("default mode (no mode specified) still retires (current month only)", async () => {
    await seedAuthSession();
    const team = await createTeam("Team");
    const seat = await createSeat("user1", 5001);

    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapshotRepo.save([
      { teamId: team.id, seatId: seat.id, month: prevMonth, year: prevYear },
      { teamId: team.id, seatId: seat.id, month: currentMonth, year: currentYear },
    ]);

    // No mode specified — should default to retire
    const [req, ctx] = makeDeleteRequest(team.id, { seatIds: [seat.id] });
    const response = await DELETE(req, ctx);
    const json = await response.json();
    expect(json.removed).toBe(1);
    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
    expect(json.mode).toBe("retire");

    // Historical snapshot should remain
    const historicalSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month: prevMonth, year: prevYear },
    });
    expect(historicalSnapshots).toHaveLength(1);
  });
});
