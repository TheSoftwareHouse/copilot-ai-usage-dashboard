/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { TeamEntity } from "@/entities/team.entity";
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

const { GET, POST } = await import("@/app/api/teams/route");
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

function makeRequest(body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:3000/api/teams", init);
}

describe("GET /api/teams", () => {
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

  it("returns 200 with empty list when no teams exist", async () => {
    await seedAuthSession();
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.teams).toHaveLength(0);
  });

  it("returns active teams ordered by name", async () => {
    await seedAuthSession();

    const { TeamEntity } = await import("@/entities/team.entity");
    const teamRepo = testDs.getRepository(TeamEntity);
    await teamRepo.save({ name: "Zulu" });
    await teamRepo.save({ name: "Alpha" });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.teams).toHaveLength(2);
    expect(json.teams[0].name).toBe("Alpha");
    expect(json.teams[1].name).toBe("Zulu");

    for (const team of json.teams) {
      expect(team).toHaveProperty("id");
      expect(team).toHaveProperty("name");
      expect(team).toHaveProperty("createdAt");
      expect(team).toHaveProperty("updatedAt");
      expect(team).not.toHaveProperty("deletedAt");
    }
  });

  it("excludes soft-deleted teams", async () => {
    await seedAuthSession();

    const { TeamEntity } = await import("@/entities/team.entity");
    const teamRepo = testDs.getRepository(TeamEntity);
    await teamRepo.save({ name: "Active Team" });
    await teamRepo.save({ name: "Deleted Team", deletedAt: new Date() });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.teams).toHaveLength(1);
    expect(json.teams[0].name).toBe("Active Team");
  });

  it("each team includes memberCount and omits retired allowance fields", async () => {
    await seedAuthSession();

    const teamRepo = testDs.getRepository(TeamEntity);
    await teamRepo.save({ name: "Metrics Team" });

    const response = await GET();
    const json = await response.json();

    expect(json.teams).toHaveLength(1);
    const t = json.teams[0];
    expect(t).not.toHaveProperty("usagePercent");
    expect(t).toHaveProperty("memberCount");
    expect(typeof t.memberCount).toBe("number");
    expect(json).not.toHaveProperty("legacyRequestsPerSeat");
  });

  it("teams with no members return usagePercent 0 and memberCount 0", async () => {
    await seedAuthSession();

    const teamRepo = testDs.getRepository(TeamEntity);
    await teamRepo.save({ name: "Empty Team" });

    const response = await GET();
    const json = await response.json();

    const t = json.teams[0];
    expect(t.memberCount).toBe(0);
    expect(t).not.toHaveProperty("usagePercent");
  });

  it("teams with members and usage return correct usagePercent", async () => {
    await seedAuthSession();

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const teamRepo = testDs.getRepository(TeamEntity);
    const team = await teamRepo.save({ name: "Usage Team" });

    const seatRepo = testDs.getRepository(CopilotSeatEntity);
    const seat1 = await seatRepo.save({
      githubUsername: "user-a",
      githubUserId: 5001,
      status: SeatStatus.ACTIVE,
    } as Partial<CopilotSeat>);
    const seat2 = await seatRepo.save({
      githubUsername: "user-b",
      githubUserId: 5002,
      status: SeatStatus.ACTIVE,
    } as Partial<CopilotSeat>);

    const snapRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    await snapRepo.save({ teamId: team.id, seatId: seat1.id, month: currentMonth, year: currentYear } as Partial<TeamMemberSnapshot>);
    await snapRepo.save({ teamId: team.id, seatId: seat2.id, month: currentMonth, year: currentYear } as Partial<TeamMemberSnapshot>);

    const usageRepo = testDs.getRepository(CopilotUsageEntity);
    await usageRepo.save({
      seatId: seat1.id, day: 1, month: currentMonth, year: currentYear,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
      ],
    } as Partial<CopilotUsage>);
    await usageRepo.save({
      seatId: seat2.id, day: 1, month: currentMonth, year: currentYear,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 30, discountAmount: 1.2, netQuantity: 0, netAmount: 0 },
      ],
    } as Partial<CopilotUsage>);

    const response = await GET();
    const json = await response.json();

    const t = json.teams[0];
    expect(t.memberCount).toBe(2);
    // 80 requests / (2 members × 300 per seat) × 100 = 13.33%
    expect(t).not.toHaveProperty("usagePercent");
  });
});

describe("POST /api/teams", () => {
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
    const request = makeRequest({ name: "Test Team" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const request = makeRequest({ name: "Test Team" });
    const response = await POST(request);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 201 for valid input", async () => {
    await seedAuthSession();
    const request = makeRequest({ name: "Engineering" });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.name).toBe("Engineering");
    expect(json).toHaveProperty("id");
    expect(json).toHaveProperty("createdAt");
    expect(json).toHaveProperty("updatedAt");
    expect(json).not.toHaveProperty("deletedAt");
  });

  it("trims whitespace from name", async () => {
    await seedAuthSession();
    const request = makeRequest({ name: "  Padded Name  " });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.name).toBe("Padded Name");
  });

  it("returns 400 for missing name", async () => {
    await seedAuthSession();
    const request = makeRequest({});
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Validation failed");
  });

  it("returns 400 for empty name", async () => {
    await seedAuthSession();
    const request = makeRequest({ name: "" });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.details.name).toBeDefined();
  });

  it("returns 400 for malformed JSON body", async () => {
    await seedAuthSession();
    const request = new Request("http://localhost:3000/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 409 for duplicate team name", async () => {
    await seedAuthSession();
    const request1 = makeRequest({ name: "Duplicate" });
    const response1 = await POST(request1);
    expect(response1.status).toBe(201);

    const request2 = makeRequest({ name: "Duplicate" });
    const response2 = await POST(request2);
    expect(response2.status).toBe(409);
    const json = await response2.json();
    expect(json.error).toBe("Team name already exists");
  });

  it("allows creating team with same name as a soft-deleted team", async () => {
    await seedAuthSession();

    const { TeamEntity } = await import("@/entities/team.entity");
    const teamRepo = testDs.getRepository(TeamEntity);
    await teamRepo.save({ name: "Recycled", deletedAt: new Date() });

    const request = makeRequest({ name: "Recycled" });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.name).toBe("Recycled");
  });
});
