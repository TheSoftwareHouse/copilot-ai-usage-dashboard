/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
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

const { GET } = await import("@/app/api/usage/seats/rankings/route");
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
  const url = new URL("http://localhost:3000/api/usage/seats/rankings");
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

describe("GET /api/usage/seats/rankings", () => {
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

  it("returns empty arrays when no seats exist", async () => {
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

  it("returns active seats with 0 usage when they have no usage records for the month", async () => {
    await seedAuthSession();

    // Seat with usage
    const seatWithUsage = await seedSeat({ githubUsername: "has-usage", githubUserId: 9001 });
    await seedUsage({ seatId: seatWithUsage.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    // Seat without any usage records
    await seedSeat({ githubUsername: "no-usage", githubUserId: 9002 });

    // Inactive seat should be excluded
    await seedSeat({ githubUsername: "inactive-seat", githubUserId: 9003, status: SeatStatus.INACTIVE });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    // Both active seats should appear
    expect(json.mostActive).toHaveLength(2);
    expect(json.leastActive).toHaveLength(2);

    // mostActive: highest usage first
    expect(json.mostActive[0].githubUsername).toBe("has-usage");
    expect(json.mostActive[0].totalRequests).toBe(150);
    expect(json.mostActive[0]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[1].githubUsername).toBe("no-usage");
    expect(json.mostActive[1].totalRequests).toBe(0);
    expect(json.mostActive[1]).not.toHaveProperty("usagePercent");

    // leastActive: lowest usage first
    expect(json.leastActive[0].githubUsername).toBe("no-usage");
    expect(json.leastActive[0].totalRequests).toBe(0);
    expect(json.leastActive[0]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[1].githubUsername).toBe("has-usage");
    expect(json.leastActive[1].totalRequests).toBe(150);
  });

  it("returns top 5 seats ordered by usage percent descending with correct display info", async () => {
    await seedAuthSession();

    // Legacy per-seat allowance removed; ranking is based on raw credit totals.
    // Seat 1: 300 requests → 100%
    const seat1 = await seedSeat({ githubUsername: "high-user", githubUserId: 1001, firstName: "Alice", lastName: "Adams" });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });

    // Seat 2: 150 requests → 50%
    const seat2 = await seedSeat({ githubUsername: "mid-user", githubUserId: 1002, firstName: "Bob", lastName: "Baker" });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    // Seat 3: 60 requests → 20%
    const seat3 = await seedSeat({ githubUsername: "low-user", githubUserId: 1003, firstName: null, lastName: null });
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(60)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(3);
    // Ordered by usage percent DESC
    expect(json.mostActive[0].githubUsername).toBe("high-user");
    expect(json.mostActive[0]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[0].totalRequests).toBe(300);
    expect(json.mostActive[0].firstName).toBe("Alice");
    expect(json.mostActive[0].lastName).toBe("Adams");
    expect(json.mostActive[0].seatId).toBe(seat1.id);

    expect(json.mostActive[1].githubUsername).toBe("mid-user");
    expect(json.mostActive[1]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[1].totalRequests).toBe(150);

    expect(json.mostActive[2].githubUsername).toBe("low-user");
    expect(json.mostActive[2]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[2].firstName).toBeNull();
    expect(json.mostActive[2].lastName).toBeNull();

    // leastActive: same 3 seats in ascending order
    expect(json.leastActive).toHaveLength(3);
    expect(json.leastActive[0].githubUsername).toBe("low-user");
    expect(json.leastActive[0]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[1].githubUsername).toBe("mid-user");
    expect(json.leastActive[1]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[2].githubUsername).toBe("high-user");
    expect(json.leastActive[2]).not.toHaveProperty("usagePercent");

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
    expect(json.mostActive).toEqual([]);
    expect(json.leastActive).toEqual([]);
  });

  it("returns fewer than 5 entries when fewer seats have data", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat({ githubUsername: "user-a", githubUserId: 2001 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(200)] });

    const seat2 = await seedSeat({ githubUsername: "user-b", githubUserId: 2002 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(100)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(2);
    expect(json.mostActive[0].githubUsername).toBe("user-a");
    expect(json.mostActive[1].githubUsername).toBe("user-b");

    // leastActive: same 2 seats in ascending order
    expect(json.leastActive).toHaveLength(2);
    expect(json.leastActive[0].githubUsername).toBe("user-b");
    expect(json.leastActive[1].githubUsername).toBe("user-a");
  });

  it("returns at most 5 entries when more than 5 seats have data", async () => {
    await seedAuthSession();

    // Create 7 seats with different usage
    const quantities = [600, 500, 400, 300, 200, 100, 50];
    for (let i = 0; i < quantities.length; i++) {
      const seat = await seedSeat({ githubUsername: `user-${i}`, githubUserId: 3001 + i });
      await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(quantities[i])] });
    }

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(5);
    // Verify order: highest usage first
    expect(json.mostActive[0].githubUsername).toBe("user-0"); // 600 requests → 200%
    expect(json.mostActive[1].githubUsername).toBe("user-1"); // 500 → 166.7%
    expect(json.mostActive[2].githubUsername).toBe("user-2"); // 400 → 133.3%
    expect(json.mostActive[3].githubUsername).toBe("user-3"); // 300 → 100%
    expect(json.mostActive[4].githubUsername).toBe("user-4"); // 200 → 66.7%
    // user-5 and user-6 excluded (beyond top 5)

    // leastActive: bottom 5 seats by usage ascending
    expect(json.leastActive).toHaveLength(5);
    expect(json.leastActive[0].githubUsername).toBe("user-6"); // 50 → 16.7%
    expect(json.leastActive[1].githubUsername).toBe("user-5"); // 100 → 33.3%
    expect(json.leastActive[2].githubUsername).toBe("user-4"); // 200 → 66.7%
    expect(json.leastActive[3].githubUsername).toBe("user-3"); // 300 → 100%
    expect(json.leastActive[4].githubUsername).toBe("user-2"); // 400 → 133.3%
    // user-0 and user-1 excluded (beyond bottom 5)
  });

  it("returns entries without legacy usagePercent fields", async () => {
    await seedAuthSession();

    // Two seats with different request counts
    const seat1 = await seedSeat({ githubUsername: "user-x", githubUserId: 4001 });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(200)] });

    const seat2 = await seedSeat({ githubUsername: "user-y", githubUserId: 4002 });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(100)] });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(2);
    // All usage percents should be 0
    expect(json.mostActive[0]).not.toHaveProperty("usagePercent");
    expect(json.mostActive[1]).not.toHaveProperty("usagePercent");
    // Tiebreaker: higher totalRequests first when percentages are equal
    expect(json.mostActive[0].totalRequests).toBe(200);
    expect(json.mostActive[0].githubUsername).toBe("user-x");
    expect(json.mostActive[1].totalRequests).toBe(100);
    expect(json.mostActive[1].githubUsername).toBe("user-y");

    // leastActive: ordered by totalRequests ASC when all percents are 0
    expect(json.leastActive).toHaveLength(2);
    expect(json.leastActive[0]).not.toHaveProperty("usagePercent");
    expect(json.leastActive[0].totalRequests).toBe(100);
    expect(json.leastActive[0].githubUsername).toBe("user-y");
    expect(json.leastActive[1].totalRequests).toBe(200);
    expect(json.leastActive[1].githubUsername).toBe("user-x");
  });

  it("returns leastActive ordered by usage percent ascending", async () => {
    await seedAuthSession();

    // 4 seats with distinct usage levels
    const seats = [
      { username: "heavy", id: 5001, qty: 450 },
      { username: "medium", id: 5002, qty: 200 },
      { username: "light", id: 5003, qty: 60 },
      { username: "minimal", id: 5004, qty: 15 },
    ];
    for (const s of seats) {
      const seat = await seedSeat({ githubUsername: s.username, githubUserId: s.id });
      await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(s.qty)] });
    }

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    // leastActive: ascending by usage percent
    expect(json.leastActive).toHaveLength(4);
    expect(json.leastActive[0].githubUsername).toBe("minimal"); // 15/300 = 5%
    expect(json.leastActive[1].githubUsername).toBe("light");   // 60/300 = 20%
    expect(json.leastActive[2].githubUsername).toBe("medium");  // 200/300 = 66.7%
    expect(json.leastActive[3].githubUsername).toBe("heavy");   // 450/300 = 150%

    // mostActive: descending (opposite order)
    expect(json.mostActive[0].githubUsername).toBe("heavy");
    expect(json.mostActive[3].githubUsername).toBe("minimal");
  });

  it("returns all seats in both lists when exactly 5 seats have data", async () => {
    await seedAuthSession();

    const quantities = [500, 400, 300, 200, 100];
    for (let i = 0; i < quantities.length; i++) {
      const seat = await seedSeat({ githubUsername: `seat-${i}`, githubUserId: 6001 + i });
      await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(quantities[i])] });
    }

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.mostActive).toHaveLength(5);
    expect(json.leastActive).toHaveLength(5);

    // mostActive: descending
    expect(json.mostActive[0].githubUsername).toBe("seat-0"); // 500
    expect(json.mostActive[4].githubUsername).toBe("seat-4"); // 100

    // leastActive: ascending — same seats, reversed order
    expect(json.leastActive[0].githubUsername).toBe("seat-4"); // 100
    expect(json.leastActive[4].githubUsername).toBe("seat-0"); // 500
  });
});
