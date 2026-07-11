/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { SeatStatus } from "@/entities/enums";
import {
  CopilotSeatEntity,
  type CopilotSeat,
} from "@/entities/copilot-seat.entity";
import {
  CopilotUsageEntity,
  type CopilotUsage,
} from "@/entities/copilot-usage.entity";
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

const { GET } = await import("@/app/api/seats/low-usage/route");
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

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/seats/low-usage");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

async function seedSeat(
  overrides: Partial<CopilotSeat> & {
    githubUsername: string;
    githubUserId: number;
  },
): Promise<CopilotSeat> {
  const seatRepo = testDs.getRepository(CopilotSeatEntity);
  return seatRepo.save({
    status: SeatStatus.ACTIVE,
    ...overrides,
  } as Partial<CopilotSeat>);
}

async function seedUsage(
  overrides: Partial<CopilotUsage> & {
    seatId: number;
    day: number;
    month: number;
    year: number;
    usageItems: unknown[];
  },
): Promise<CopilotUsage> {
  const usageRepo = testDs.getRepository(CopilotUsageEntity);
  return usageRepo.save(overrides as Partial<CopilotUsage>);
}

function makeUsageItem(grossQuantity: number) {
  return {
    product: "Copilot",
    sku: "Premium",
    model: "GPT-4o",
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

const now = new Date();
const CURRENT_MONTH = now.getUTCMonth() + 1;
const CURRENT_YEAR = now.getUTCFullYear();

describe("GET /api/seats/low-usage", () => {
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

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns empty response when no seats exist", async () => {
    await seedAuthSession();
    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.seats).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(10);
    expect(json.totalPages).toBe(1);
    expect(json).not.toHaveProperty("legacyRequestsPerSeat");
  });

  it("returns active seats with gross credit totals", async () => {
    await seedAuthSession();

    const lowSeat = await seedSeat({
      githubUsername: "low-user",
      githubUserId: 1,
      firstName: "Low",
      lastName: "User",
      department: "Engineering",
    });
    await seedUsage({
      seatId: lowSeat.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(100)],
    });

    const highSeat = await seedSeat({
      githubUsername: "high-user",
      githubUserId: 2,
      firstName: "High",
      lastName: "User",
      department: "Design",
    });
    await seedUsage({
      seatId: highSeat.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(350)],
    });

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seats).toHaveLength(2);
    expect(json.seats[0].githubUsername).toBe("low-user");
    expect(json.seats[1].githubUsername).toBe("high-user");
    expect(json.total).toBe(2);
  });

  it("excludes inactive seats", async () => {
    await seedAuthSession();

    const inactiveSeat = await seedSeat({
      githubUsername: "inactive-user",
      githubUserId: 1,
      status: SeatStatus.INACTIVE,
    });
    await seedUsage({
      seatId: inactiveSeat.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(50)],
    });

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.seats).toEqual([]);
    expect(json.total).toBe(0);
  });

  it("includes seats regardless of legacy allowance thresholds", async () => {
    await seedAuthSession();

    const exactSeat = await seedSeat({
      githubUsername: "exact-user",
      githubUserId: 1,
    });
    await seedUsage({
      seatId: exactSeat.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(300)],
    });

    const overSeat = await seedSeat({
      githubUsername: "over-user",
      githubUserId: 2,
    });
    await seedUsage({
      seatId: overSeat.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(500)],
    });

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.seats).toHaveLength(2);
    expect(json.total).toBe(2);
  });

  it("includes active seats with zero usage (no usage records)", async () => {
    await seedAuthSession();

    await seedSeat({
      githubUsername: "no-usage-user",
      githubUserId: 1,
      firstName: "No",
      lastName: "Usage",
      department: "Marketing",
    });

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seats).toHaveLength(1);
    expect(json.seats[0].githubUsername).toBe("no-usage-user");
    expect(json.seats[0].totalRequests).toBe(0);
    expect(json.seats[0]).not.toHaveProperty("usagePercent");
  });

  it("returns correct response shape", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "shape-user",
      githubUserId: 1,
      firstName: "Shape",
      lastName: "Test",
      department: "QA",
    });
    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(150)],
    });

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toHaveProperty("seats");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("page");
    expect(json).toHaveProperty("pageSize");
    expect(json).toHaveProperty("totalPages");
    expect(json).not.toHaveProperty("legacyRequestsPerSeat");

    const s = json.seats[0];
    expect(s).toHaveProperty("seatId");
    expect(s).toHaveProperty("githubUsername");
    expect(s).toHaveProperty("firstName");
    expect(s).toHaveProperty("lastName");
    expect(s).toHaveProperty("department");
    expect(s).toHaveProperty("totalRequests");
    expect(s).not.toHaveProperty("usagePercent");

    expect(s.seatId).toBe(seat.id);
    expect(s.githubUsername).toBe("shape-user");
    expect(s.firstName).toBe("Shape");
    expect(s.lastName).toBe("Test");
    expect(s.department).toBe("QA");
    expect(s.totalRequests).toBe(150);
    expect(s).not.toHaveProperty("usagePercent");
  });

  it("paginates correctly", async () => {
    await seedAuthSession();

    for (let i = 1; i <= 5; i++) {
      const seat = await seedSeat({
        githubUsername: `user-${i}`,
        githubUserId: i,
      });
      await seedUsage({
        seatId: seat.id,
        day: 1,
        month: CURRENT_MONTH,
        year: CURRENT_YEAR,
        usageItems: [makeUsageItem(i * 10)],
      });
    }

    const req1 = makeGetRequest({ page: "1", pageSize: "2" });
    const res1 = await GET(req1 as never);
    const json1 = await res1.json();
    expect(json1.seats).toHaveLength(2);
    expect(json1.total).toBe(5);
    expect(json1.page).toBe(1);
    expect(json1.pageSize).toBe(2);
    expect(json1.totalPages).toBe(3);

    const req2 = makeGetRequest({ page: "3", pageSize: "2" });
    const res2 = await GET(req2 as never);
    const json2 = await res2.json();
    expect(json2.seats).toHaveLength(1);
    expect(json2.page).toBe(3);
  });

  it("sorts ascending by usagePercent by default", async () => {
    await seedAuthSession();

    const seatA = await seedSeat({
      githubUsername: "medium-user",
      githubUserId: 1,
    });
    await seedUsage({
      seatId: seatA.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(150)],
    });

    const seatB = await seedSeat({
      githubUsername: "low-user",
      githubUserId: 2,
    });
    await seedUsage({
      seatId: seatB.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(30)],
    });

    await seedSeat({
      githubUsername: "zero-user",
      githubUserId: 3,
    });
    // No usage for zero-user — 0%

    const request = makeGetRequest();
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(3);
    expect(json.seats[0].githubUsername).toBe("zero-user");
    expect(json.seats[1].githubUsername).toBe("low-user");
    expect(json.seats[2].githubUsername).toBe("medium-user");
  });

  it("sorts descending when sortOrder=desc", async () => {
    await seedAuthSession();

    const seatA = await seedSeat({
      githubUsername: "medium-user",
      githubUserId: 1,
    });
    await seedUsage({
      seatId: seatA.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(150)],
    });

    const seatB = await seedSeat({
      githubUsername: "low-user",
      githubUserId: 2,
    });
    await seedUsage({
      seatId: seatB.id,
      day: 1,
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      usageItems: [makeUsageItem(30)],
    });

    const request = makeGetRequest({ sortOrder: "desc" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(2);
    expect(json.seats[0].githubUsername).toBe("medium-user");
    expect(json.seats[1].githubUsername).toBe("low-user");
  });

  it("sorts by githubUsername", async () => {
    await seedAuthSession();

    await seedSeat({ githubUsername: "charlie", githubUserId: 3 });
    await seedSeat({ githubUsername: "alice", githubUserId: 1 });
    await seedSeat({ githubUsername: "bob", githubUserId: 2 });

    const request = makeGetRequest({ sortBy: "githubUsername" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(3);
    expect(json.seats[0].githubUsername).toBe("alice");
    expect(json.seats[1].githubUsername).toBe("bob");
    expect(json.seats[2].githubUsername).toBe("charlie");
  });

  it("sorts by department", async () => {
    await seedAuthSession();

    await seedSeat({
      githubUsername: "user-z",
      githubUserId: 1,
      department: "Zebra",
    });
    await seedSeat({
      githubUsername: "user-a",
      githubUserId: 2,
      department: "Alpha",
    });
    await seedSeat({
      githubUsername: "user-m",
      githubUserId: 3,
      department: "Middle",
    });

    const request = makeGetRequest({ sortBy: "department" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(3);
    expect(json.seats[0].department).toBe("Alpha");
    expect(json.seats[1].department).toBe("Middle");
    expect(json.seats[2].department).toBe("Zebra");
  });
});
