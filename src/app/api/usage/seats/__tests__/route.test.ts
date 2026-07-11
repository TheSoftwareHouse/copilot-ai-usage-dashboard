/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { ConfigurationEntity, type Configuration } from "@/entities/configuration.entity";
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

const { GET } = await import("@/app/api/usage/seats/route");
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
  const url = new URL("http://localhost:3000/api/usage/seats");
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

async function seedConfiguration(
  overrides: Partial<Configuration> & { apiMode: string; entityName: string },
): Promise<Configuration> {
  const configRepo = testDs.getRepository(ConfigurationEntity);
  return configRepo.save(overrides as Partial<Configuration>);
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
    discountQuantity: 0,
    discountAmount: 0,
    netQuantity: grossQuantity,
    netAmount: grossQuantity * 0.04,
  };
}

describe("GET /api/usage/seats", () => {
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

  it("returns empty state when no usage data exists for the month", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seats).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(20);
    expect(json.totalPages).toBe(1);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("returns aggregated per-seat usage data with model breakdown", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "user1",
      githubUserId: 1001,
      firstName: "Alice",
      lastName: "Smith",
      department: "Engineering",
    });

    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
        { product: "Copilot", sku: "Premium", model: "Claude Haiku 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 10, discountAmount: 0.4, netQuantity: 0, netAmount: 0 },
      ],
    });

    await seedUsage({
      seatId: seat.id,
      day: 2,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 30, discountAmount: 1.2, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.seats).toHaveLength(1);
    expect(json.total).toBe(1);

    const s = json.seats[0];
    expect(s.seatId).toBe(seat.id);
    expect(s.githubUsername).toBe("user1");
    expect(s.firstName).toBe("Alice");
    expect(s.lastName).toBe("Smith");
    expect(s.department).toBe("Engineering");
    expect(s.totalRequests).toBe(90);
    expect(s.totalGrossAmount).toBeCloseTo(3.6, 2);
    expect(s.totalNetAmount).toBe(0);

    expect(s.models).toHaveLength(2);
    // Models ordered by requests DESC
    expect(s.models[0].model).toBe("Claude Sonnet 4.5");
    expect(s.models[0].requests).toBe(80);
    expect(s.models[0].grossAmount).toBeCloseTo(3.2, 2);
    expect(s.models[1].model).toBe("Claude Haiku 4.5");
    expect(s.models[1].requests).toBe(10);
  });

  it("paginates correctly", async () => {
    await seedAuthSession();

    // Seed 3 seats with usage
    for (let i = 1; i <= 3; i++) {
      const seat = await seedSeat({
        githubUsername: `user${i}`,
        githubUserId: 1000 + i,
      });
      await seedUsage({
        seatId: seat.id,
        day: 1,
        month: 2,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: i * 10, grossAmount: i * 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: i * 10, netAmount: i * 0.4 },
        ],
      });
    }

    // Page 1 with pageSize 2
    const req1 = makeGetRequest({ month: "2", year: "2026", page: "1", pageSize: "2" });
    const res1 = await GET(req1 as never);
    const json1 = await res1.json();

    expect(json1.seats).toHaveLength(2);
    expect(json1.total).toBe(3);
    expect(json1.page).toBe(1);
    expect(json1.pageSize).toBe(2);
    expect(json1.totalPages).toBe(2);

    // Page 2
    const req2 = makeGetRequest({ month: "2", year: "2026", page: "2", pageSize: "2" });
    const res2 = await GET(req2 as never);
    const json2 = await res2.json();

    expect(json2.seats).toHaveLength(1);
    expect(json2.page).toBe(2);
    expect(json2.totalPages).toBe(2);
  });

  it("returns costStats from all selected-month usage even when paginated", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat({
      githubUsername: "page-user-1",
      githubUserId: 9001,
      firstName: "Page",
      lastName: "One",
    });
    const seat2 = await seedSeat({
      githubUsername: "page-user-2",
      githubUserId: 9002,
      firstName: "Page",
      lastName: "Two",
    });

    await seedUsage({
      seatId: seat1.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.01, grossQuantity: 1500, grossAmount: 15, discountQuantity: 0, discountAmount: 0, netQuantity: 1500, netAmount: 15 },
      ],
    });
    await seedUsage({
      seatId: seat2.id,
      day: 5,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.01, grossQuantity: 1500, grossAmount: 15, discountQuantity: 0, discountAmount: 0, netQuantity: 1500, netAmount: 15 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026", page: "1", pageSize: "1" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(1);
    expect(json.total).toBe(2);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
    expect(json.costStats.totalCost).toBeCloseTo(30, 2);
    expect(json.costStats.averageDailyCost).toBeCloseTo(1.07, 2);
    expect(json.costStats.predictedMonthCost).toBeCloseTo(21.4, 2);
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

  it("defaults to page 1, pageSize 20 when params are invalid", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026", page: "abc", pageSize: "-5" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(20);
  });

  it("caps pageSize at 100", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026", pageSize: "500" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.pageSize).toBe(100);
  });

  it("orders seats by totalRequests DESC", async () => {
    await seedAuthSession();

    const seatLow = await seedSeat({ githubUsername: "low-user", githubUserId: 2001 });
    const seatHigh = await seedSeat({ githubUsername: "high-user", githubUserId: 2002 });

    await seedUsage({
      seatId: seatLow.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 5, grossAmount: 0.2, discountQuantity: 0, discountAmount: 0, netQuantity: 5, netAmount: 0.2 },
      ],
    });

    await seedUsage({
      seatId: seatHigh.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 100, netAmount: 4.0 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(2);
    expect(json.seats[0].githubUsername).toBe("high-user");
    expect(json.seats[1].githubUsername).toBe("low-user");
  });

  it("returns multiple models per seat in the models array", async () => {
    await seedAuthSession();

    const seat = await seedSeat({ githubUsername: "multi-model", githubUserId: 3001 });

    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 20, grossAmount: 0.8, discountQuantity: 0, discountAmount: 0, netQuantity: 20, netAmount: 0.8 },
        { product: "Copilot", sku: "Premium", model: "Claude Sonnet 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 40, grossAmount: 1.6, discountQuantity: 0, discountAmount: 0, netQuantity: 40, netAmount: 1.6 },
        { product: "Copilot", sku: "Premium", model: "Claude Haiku 4.5", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 5, grossAmount: 0.2, discountQuantity: 0, discountAmount: 0, netQuantity: 5, netAmount: 0.2 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.seats).toHaveLength(1);
    expect(json.seats[0].models).toHaveLength(3);

    const modelNames = json.seats[0].models.map((m: { model: string }) => m.model);
    expect(modelNames).toContain("GPT-4o");
    expect(modelNames).toContain("Claude Sonnet 4.5");
    expect(modelNames).toContain("Claude Haiku 4.5");

    // Ordered by requests DESC
    expect(json.seats[0].models[0].model).toBe("Claude Sonnet 4.5");
    expect(json.seats[0].models[0].requests).toBe(40);
  });

  describe("search parameter", () => {
    async function seedSearchFixtures() {
      const alice = await seedSeat({
        githubUsername: "alice-dev",
        githubUserId: 2001,
        firstName: "Alice",
        lastName: "Smith",
      });
      await seedUsage({
        seatId: alice.id,
        day: 1,
        month: 3,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      const bob = await seedSeat({
        githubUsername: "bob-eng",
        githubUserId: 2002,
        firstName: "Bob",
        lastName: "AliceJones",
      });
      await seedUsage({
        seatId: bob.id,
        day: 1,
        month: 3,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 20, grossAmount: 0.8, discountQuantity: 0, discountAmount: 0, netQuantity: 20, netAmount: 0.8 },
        ],
      });

      const charlie = await seedSeat({
        githubUsername: "charlie-ops",
        githubUserId: 2003,
        firstName: "Charlie",
        lastName: "Brown",
      });
      await seedUsage({
        seatId: charlie.id,
        day: 1,
        month: 3,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 0, discountAmount: 0, netQuantity: 30, netAmount: 1.2 },
        ],
      });

      return { alice, bob, charlie };
    }

    it("filters by githubUsername", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026", search: "alice-dev" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(1);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].githubUsername).toBe("alice-dev");
    });

    it("filters by firstName", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026", search: "Bob" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(1);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].firstName).toBe("Bob");
    });

    it("filters by lastName", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026", search: "Brown" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(1);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].lastName).toBe("Brown");
    });

    it("search is case-insensitive", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026", search: "CHARLIE" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(1);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].firstName).toBe("Charlie");
    });

    it("returns partial matches across multiple fields", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      // "alice" matches alice-dev (githubUsername) AND Bob's lastName "AliceJones"
      const request = makeGetRequest({ month: "3", year: "2026", search: "alice" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(2);
      expect(json.seats).toHaveLength(2);
      const usernames = json.seats.map((s: { githubUsername: string }) => s.githubUsername);
      expect(usernames).toContain("alice-dev");
      expect(usernames).toContain("bob-eng");
    });

    it("returns empty array with total 0 when no seats match", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026", search: "nonexistent" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.seats).toEqual([]);
      expect(json.total).toBe(0);
      expect(json.totalPages).toBe(1);
    });

    it("returns all seats when search param is empty", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026", search: "" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(3);
      expect(json.seats).toHaveLength(3);
    });

    it("returns all seats when search param is not provided", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      const request = makeGetRequest({ month: "3", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(3);
      expect(json.seats).toHaveLength(3);
    });

    it("pagination works correctly with active search", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      // "alice" matches 2 seats; paginate with pageSize=1
      const req1 = makeGetRequest({ month: "3", year: "2026", search: "alice", page: "1", pageSize: "1" });
      const res1 = await GET(req1 as never);
      const json1 = await res1.json();

      expect(json1.total).toBe(2);
      expect(json1.seats).toHaveLength(1);
      expect(json1.page).toBe(1);
      expect(json1.pageSize).toBe(1);
      expect(json1.totalPages).toBe(2);

      const req2 = makeGetRequest({ month: "3", year: "2026", search: "alice", page: "2", pageSize: "1" });
      const res2 = await GET(req2 as never);
      const json2 = await res2.json();

      expect(json2.total).toBe(2);
      expect(json2.seats).toHaveLength(1);
      expect(json2.page).toBe(2);
      expect(json2.totalPages).toBe(2);

      // The two pages should return different seats
      expect(json1.seats[0].githubUsername).not.toBe(json2.seats[0].githubUsername);
    });

    it("sorts search results by sortBy and sortOrder params", async () => {
      await seedAuthSession();
      await seedSearchFixtures();

      // "alice" matches alice-dev and bob-eng (via lastName "AliceJones")
      // Sort by githubUsername ASC
      const request = makeGetRequest({
        month: "3",
        year: "2026",
        search: "alice",
        sortBy: "githubUsername",
        sortOrder: "asc",
      });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(2);
      expect(json.seats[0].githubUsername).toBe("alice-dev");
      expect(json.seats[1].githubUsername).toBe("bob-eng");
    });

    it("escapes special ILIKE characters in search term", async () => {
      await seedAuthSession();

      // Seed a seat whose username literally contains an underscore
      const seat = await seedSeat({
        githubUsername: "user_one",
        githubUserId: 2010,
        firstName: "Under",
        lastName: "Score",
      });
      await seedUsage({
        seatId: seat.id,
        day: 1,
        month: 3,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      // Seed another seat that would match if _ were treated as a wildcard
      const seat2 = await seedSeat({
        githubUsername: "userXone",
        githubUserId: 2011,
        firstName: "No",
        lastName: "Match",
      });
      await seedUsage({
        seatId: seat2.id,
        day: 1,
        month: 3,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 5, grossAmount: 0.2, discountQuantity: 0, discountAmount: 0, netQuantity: 5, netAmount: 0.2 },
        ],
      });

      // Search for literal "_" — should only match user_one, not userXone
      const request = makeGetRequest({ month: "3", year: "2026", search: "user_one" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(1);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].githubUsername).toBe("user_one");
    });
  });

  describe("sorting parameters", () => {
    async function seedSortFixtures() {
      const alice = await seedSeat({
        githubUsername: "alice-dev",
        githubUserId: 4001,
        firstName: "Alice",
        lastName: "Smith",
        department: "Engineering",
      });
      await seedUsage({
        seatId: alice.id,
        day: 1,
        month: 2,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 0, discountAmount: 0, netQuantity: 50, netAmount: 2.0 },
        ],
      });

      const bob = await seedSeat({
        githubUsername: "bob-eng",
        githubUserId: 4002,
        firstName: "Bob",
        lastName: "Jones",
        department: "Design",
      });
      await seedUsage({
        seatId: bob.id,
        day: 1,
        month: 2,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 100, netAmount: 4.0 },
        ],
      });

      const charlie = await seedSeat({
        githubUsername: "charlie-ops",
        githubUserId: 4003,
        firstName: "Charlie",
        lastName: "Brown",
        department: "Accounting",
      });
      await seedUsage({
        seatId: charlie.id,
        day: 1,
        month: 2,
        year: 2026,
        usageItems: [
          { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 10, netAmount: 0.4 },
        ],
      });

      return { alice, bob, charlie };
    }

    it("default sort order is totalRequests DESC", async () => {
      await seedAuthSession();
      await seedSortFixtures();

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(3);
      expect(json.seats[0].githubUsername).toBe("bob-eng");
      expect(json.seats[1].githubUsername).toBe("alice-dev");
      expect(json.seats[2].githubUsername).toBe("charlie-ops");
    });

    it("sorts by githubUsername ASC", async () => {
      await seedAuthSession();
      await seedSortFixtures();

      const request = makeGetRequest({
        month: "2",
        year: "2026",
        sortBy: "githubUsername",
        sortOrder: "asc",
      });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(3);
      expect(json.seats[0].githubUsername).toBe("alice-dev");
      expect(json.seats[1].githubUsername).toBe("bob-eng");
      expect(json.seats[2].githubUsername).toBe("charlie-ops");
    });

    it("sorts by totalGrossAmount DESC", async () => {
      await seedAuthSession();
      await seedSortFixtures();

      const request = makeGetRequest({
        month: "2",
        year: "2026",
        sortBy: "totalGrossAmount",
        sortOrder: "desc",
      });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(3);
      expect(json.seats[0].githubUsername).toBe("bob-eng");
      expect(json.seats[0].totalGrossAmount).toBe(4.0);
      expect(json.seats[1].githubUsername).toBe("alice-dev");
      expect(json.seats[1].totalGrossAmount).toBe(2.0);
      expect(json.seats[2].githubUsername).toBe("charlie-ops");
      expect(json.seats[2].totalGrossAmount).toBeCloseTo(0.4, 2);
    });

    it("falls back to default sort when sortBy is invalid", async () => {
      await seedAuthSession();
      await seedSortFixtures();

      const request = makeGetRequest({
        month: "2",
        year: "2026",
        sortBy: "invalidField",
        sortOrder: "asc",
      });
      const response = await GET(request as never);
      const json = await response.json();

      // Falls back to totalRequests, but sortOrder=asc is still honored
      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(3);
      expect(json.seats[0].githubUsername).toBe("charlie-ops");
      expect(json.seats[1].githubUsername).toBe("alice-dev");
      expect(json.seats[2].githubUsername).toBe("bob-eng");
    });

    it("falls back to default sort order when sortOrder is invalid", async () => {
      await seedAuthSession();
      await seedSortFixtures();

      const request = makeGetRequest({
        month: "2",
        year: "2026",
        sortBy: "totalRequests",
        sortOrder: "invalid",
      });
      const response = await GET(request as never);
      const json = await response.json();

      // Falls back to desc
      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(3);
      expect(json.seats[0].githubUsername).toBe("bob-eng");
      expect(json.seats[1].githubUsername).toBe("alice-dev");
      expect(json.seats[2].githubUsername).toBe("charlie-ops");
    });
  });

  describe("deviation data", () => {
    // Static thresholds: warning at 10 AIC Units, alert at 15 AIC Units.

    async function seedDeviationFixtures() {
      await seedConfiguration({
        apiMode: "organisation" as never,
        entityName: "test-org",
        normSeatsCount: 2,
        deviationWarningThreshold: 10,
        deviationAlertThreshold: 15,
      });

      // Previous month seats (January 2026) for norm calculation
      const prevSeatA = await seedSeat({ githubUsername: "prev-a", githubUserId: 9001 });
      const prevSeatB = await seedSeat({ githubUsername: "prev-b", githubUserId: 9002 });

      // Seat A: 310 total requests across January (10 per day for 31 days)
      await seedUsage({
        seatId: prevSeatA.id,
        day: 1,
        month: 1,
        year: 2026,
        usageItems: [makeUsageItem(310)],
      });

      // Seat B: 155 total requests across January
      await seedUsage({
        seatId: prevSeatB.id,
        day: 1,
        month: 1,
        year: 2026,
        usageItems: [makeUsageItem(155)],
      });

      // Current month (February 2026) - seats with varying peak AIC usage
      const alertSeat = await seedSeat({
        githubUsername: "alert-user",
        githubUserId: 9010,
        firstName: "Alert",
        lastName: "User",
      });
      // Day 5 has 20 AIC Units → alert (>= 15)
      await seedUsage({
        seatId: alertSeat.id,
        day: 5,
        month: 2,
        year: 2026,
        usageItems: [makeUsageItem(20)],
      });
      // Day 3 has 5 requests → normal
      await seedUsage({
        seatId: alertSeat.id,
        day: 3,
        month: 2,
        year: 2026,
        usageItems: [makeUsageItem(5)],
      });

      const warningSeat = await seedSeat({
        githubUsername: "warning-user",
        githubUserId: 9011,
        firstName: "Warning",
        lastName: "User",
      });
      // Day 10 has 12 AIC Units → warning (>= 10 and < 15)
      await seedUsage({
        seatId: warningSeat.id,
        day: 10,
        month: 2,
        year: 2026,
        usageItems: [makeUsageItem(12)],
      });

      const normalSeat = await seedSeat({
        githubUsername: "normal-user",
        githubUserId: 9012,
        firstName: "Normal",
        lastName: "User",
      });
      // Day 1 has 5 AIC Units → none (< 10)
      await seedUsage({
        seatId: normalSeat.id,
        day: 1,
        month: 2,
        year: 2026,
        usageItems: [makeUsageItem(5)],
      });

      return { alertSeat, warningSeat, normalSeat, prevSeatA, prevSeatB };
    }

    it("each seat includes deviationLevel, normValue, peakMultiplier, peakDay", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      for (const seat of json.seats) {
        expect(seat).toHaveProperty("deviationLevel");
        expect(seat).toHaveProperty("normValue");
        expect(seat).toHaveProperty("peakMultiplier");
        expect(seat).toHaveProperty("peakDay");
      }
    });

    it("seat with alert-level peak returns deviationLevel 'alert' with correct peakMultiplier and peakDay", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      const alertUser = json.seats.find((s: { githubUsername: string }) => s.githubUsername === "alert-user");
      expect(alertUser).toBeDefined();
      expect(alertUser.deviationLevel).toBe("alert");
      expect(alertUser.peakMultiplier).toBe(20);
      expect(alertUser.peakDay).toBe(5);
    });

    it("seat with warning-level peak returns deviationLevel 'warning'", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      const warningUser = json.seats.find((s: { githubUsername: string }) => s.githubUsername === "warning-user");
      expect(warningUser).toBeDefined();
      expect(warningUser.deviationLevel).toBe("warning");
      expect(warningUser.peakMultiplier).toBe(12);
      expect(warningUser.peakDay).toBe(10);
    });

    it("seat with normal usage returns deviationLevel 'none' with peak values preserved", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      const normalUser = json.seats.find((s: { githubUsername: string }) => s.githubUsername === "normal-user");
      expect(normalUser).toBeDefined();
      expect(normalUser.deviationLevel).toBe("none");
      expect(normalUser.peakMultiplier).toBe(5);
      expect(normalUser.peakDay).toBe(1);
    });

    it("static thresholds still work when no previous month data exists", async () => {
      await seedAuthSession();

      await seedConfiguration({
        apiMode: "organisation" as never,
        entityName: "test-org",
        normSeatsCount: 2,
        deviationWarningThreshold: 150,
        deviationAlertThreshold: 250,
      });

      const seat = await seedSeat({ githubUsername: "no-norm-user", githubUserId: 9020 });
      await seedUsage({
        seatId: seat.id,
        day: 1,
        month: 2,
        year: 2026,
        usageItems: [makeUsageItem(100)],
      });

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].deviationLevel).toBe("none");
      expect(json.seats[0].normValue).toBeNull();
      expect(json.seats[0].peakMultiplier).toBe(100);
      expect(json.seats[0].peakDay).toBe(1);
    });

    it("normValue remains null across all seats in the response", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      const request = makeGetRequest({ month: "2", year: "2026" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(json.seats.length).toBeGreaterThan(1);
      const firstNorm = json.seats[0].normValue;
      for (const seat of json.seats) {
        expect(seat.normValue).toBe(firstNorm);
      }
      expect(firstNorm).toBeNull();
    });

    it("pagination still works with deviation fields present", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      // 3 seats with Feb 2026 usage; paginate with pageSize=2
      const req1 = makeGetRequest({ month: "2", year: "2026", page: "1", pageSize: "2" });
      const res1 = await GET(req1 as never);
      const json1 = await res1.json();

      expect(json1.seats).toHaveLength(2);
      expect(json1.total).toBe(3);
      expect(json1.totalPages).toBe(2);

      // Every seat on page 1 has deviation fields
      for (const seat of json1.seats) {
        expect(seat).toHaveProperty("deviationLevel");
        expect(seat).toHaveProperty("normValue");
        expect(seat).toHaveProperty("peakMultiplier");
        expect(seat).toHaveProperty("peakDay");
      }

      // Page 2
      const req2 = makeGetRequest({ month: "2", year: "2026", page: "2", pageSize: "2" });
      const res2 = await GET(req2 as never);
      const json2 = await res2.json();

      expect(json2.seats).toHaveLength(1);
      expect(json2.seats[0]).toHaveProperty("deviationLevel");
    });

    it("search results include deviation data", async () => {
      await seedAuthSession();
      await seedDeviationFixtures();

      const request = makeGetRequest({ month: "2", year: "2026", search: "alert" });
      const response = await GET(request as never);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.total).toBe(1);
      expect(json.seats).toHaveLength(1);
      expect(json.seats[0].githubUsername).toBe("alert-user");
      expect(json.seats[0].deviationLevel).toBe("alert");
      expect(json.seats[0].normValue).toBeNull();
      expect(json.seats[0].peakMultiplier).toBe(20);
      expect(json.seats[0].peakDay).toBe(5);
    });
  });
});
