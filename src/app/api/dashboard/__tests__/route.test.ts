/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import type { DashboardMonthlySummary } from "@/entities/dashboard-monthly-summary.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import type { CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity } from "@/entities/copilot-usage.entity";
import type { CopilotUsage } from "@/entities/copilot-usage.entity";
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

const { GET } = await import("@/app/api/dashboard/route");
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
  const url = new URL("http://localhost:3000/api/dashboard");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

async function seedSummary(
  overrides: Partial<DashboardMonthlySummary> & { month: number; year: number },
): Promise<DashboardMonthlySummary> {
  const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
  return repo.save({
    totalSeats: 10,
    activeSeats: 8,
    totalSpending: 500.0,
    seatBaseCost: 152.0,
    totalPremiumRequests: 1200,
    includedPremiumRequestsUsed: 900,
    modelUsage: [
      { model: "GPT-4o", totalRequests: 100, totalAmount: 300 },
      { model: "Claude Sonnet 4.5", totalRequests: 50, totalAmount: 200 },
    ],
    mostActiveUsers: [
      { seatId: 1, githubUsername: "top-user", firstName: "Top", lastName: "User", totalRequests: 500, totalSpending: 250 },
    ],
    leastActiveUsers: [
      { seatId: 2, githubUsername: "low-user", firstName: "Low", lastName: "User", totalRequests: 10, totalSpending: 5 },
    ],
    ...overrides,
  } as Partial<DashboardMonthlySummary>);
}

async function seedSeat(
  overrides: Partial<CopilotSeat> & { githubUsername: string },
): Promise<CopilotSeat> {
  const seatRepo = testDs.getRepository(CopilotSeatEntity);
  return seatRepo.save({
    githubUserId: Math.floor(Math.random() * 1000000),
    status: SeatStatus.ACTIVE,
    assignedAt: new Date(),
    ...overrides,
  } as Partial<CopilotSeat>);
}

async function seedUsage(
  overrides: Partial<CopilotUsage> & { seatId: number; day: number; month: number; year: number; usageItems: unknown[] },
): Promise<CopilotUsage> {
  const usageRepo = testDs.getRepository(CopilotUsageEntity);
  return usageRepo.save(overrides as Partial<CopilotUsage>);
}

describe("GET /api/dashboard", () => {
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

  it("returns current month/year when no query params provided", async () => {
    await seedAuthSession();

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const request = makeGetRequest();
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("returns stored summary data when row exists", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.totalSeats).toBe(10);
    expect(json.activeSeats).toBe(8);
    expect(json.totalSpending).toBe(500);
    expect(json.seatBaseCost).toBe(152);
    expect(json.includedPremiumRequests).toBe(2400);
    expect(json.includedPremiumRequestsUsed).toBe(900);
    expect(json.includedPremiumRequestsRemaining).toBe(1500);
    expect(json.totalPremiumRequests).toBe(1200);
    expect(json.paidPremiumRequests).toBe(300);
    expect(json.modelUsage).toHaveLength(2);
    expect(json.modelUsage[0].model).toBe("GPT-4o");
    expect(json.mostActiveUsers).toHaveLength(1);
    expect(json.mostActiveUsers[0].githubUsername).toBe("top-user");
    expect(json.mostActiveUsers[0].totalSpending).toBe(250);
    expect(json.mostActiveUsers[0].seatId).toBe(1);
    expect(json.leastActiveUsers).toHaveLength(1);
    expect(json.leastActiveUsers[0].githubUsername).toBe("low-user");
    expect(json.leastActiveUsers[0].totalSpending).toBe(5);
    expect(json.leastActiveUsers[0].seatId).toBe(2);
    expect(json.premiumRequestsPerSeat).toBe(300);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("returns empty-state response when no row exists", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "6", year: "2025" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.totalSeats).toBe(0);
    expect(json.activeSeats).toBe(0);
    expect(json.totalSpending).toBe(0);
    expect(json.seatBaseCost).toBe(0);
    expect(json.includedPremiumRequests).toBe(0);
    expect(json.includedPremiumRequestsUsed).toBe(0);
    expect(json.includedPremiumRequestsRemaining).toBe(0);
    expect(json.totalPremiumRequests).toBe(0);
    expect(json.paidPremiumRequests).toBe(0);
    expect(json.premiumRequestsPerSeat).toBe(300);
    expect(json.modelUsage).toEqual([]);
    expect(json.mostActiveUsers).toEqual([]);
    expect(json.leastActiveUsers).toEqual([]);
    expect(json.month).toBe(6);
    expect(json.year).toBe(2025);
  });

  it("handles explicit month and year query parameters", async () => {
    await seedAuthSession();
    await seedSummary({ month: 1, year: 2026, totalSeats: 5, activeSeats: 3, totalSpending: 100 });
    await seedSummary({ month: 3, year: 2026, totalSeats: 15, activeSeats: 12, totalSpending: 900 });

    const request1 = makeGetRequest({ month: "1", year: "2026" });
    const response1 = await GET(request1 as never);
    const json1 = await response1.json();
    expect(json1.totalSeats).toBe(5);
    expect(json1.month).toBe(1);

    const request3 = makeGetRequest({ month: "3", year: "2026" });
    const response3 = await GET(request3 as never);
    const json3 = await response3.json();
    expect(json3.totalSeats).toBe(15);
    expect(json3.month).toBe(3);
  });

  it("returns valid response structure with all expected fields", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json).toHaveProperty("totalSeats");
    expect(json).toHaveProperty("activeSeats");
    expect(json).toHaveProperty("totalSpending");
    expect(json).toHaveProperty("seatBaseCost");
    expect(json).toHaveProperty("includedPremiumRequests");
    expect(json).toHaveProperty("includedPremiumRequestsUsed");
    expect(json).toHaveProperty("includedPremiumRequestsRemaining");
    expect(json).toHaveProperty("totalPremiumRequests");
    expect(json).toHaveProperty("paidPremiumRequests");
    expect(json).toHaveProperty("premiumRequestsPerSeat");
    expect(json).toHaveProperty("previousIncludedPremiumRequests");
    expect(json).toHaveProperty("previousIncludedPremiumRequestsUsed");
    expect(json).toHaveProperty("modelUsage");
    expect(json).toHaveProperty("mostActiveUsers");
    expect(json).toHaveProperty("leastActiveUsers");
    expect(json).toHaveProperty("dailyUsage");
    expect(json).toHaveProperty("previousDailyUsage");
    expect(json).toHaveProperty("topDailySpendings");
    expect(json).toHaveProperty("month");
    expect(json).toHaveProperty("year");
  });

  it("falls back to current month/year for invalid query params", async () => {
    await seedAuthSession();

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    // Invalid month (13) and year (abc)
    const request = makeGetRequest({ month: "13", year: "abc" });
    const response = await GET(request as never);
    const json = await response.json();
    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("returns previous month data when previous summary exists", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });
    await seedSummary({ month: 1, year: 2026, activeSeats: 5, includedPremiumRequestsUsed: 400 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    // Previous month: 5 active seats × 300 = 1500
    expect(json.previousIncludedPremiumRequests).toBe(1500);
    expect(json.previousIncludedPremiumRequestsUsed).toBe(400);
  });

  it("returns null for previous month data when no previous summary exists", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.previousIncludedPremiumRequests).toBeNull();
    expect(json.previousIncludedPremiumRequestsUsed).toBeNull();
  });

  it("handles year boundary — January fetches December of previous year", async () => {
    await seedAuthSession();
    await seedSummary({ month: 1, year: 2026 });
    await seedSummary({ month: 12, year: 2025, activeSeats: 6, includedPremiumRequestsUsed: 500 });

    const request = makeGetRequest({ month: "1", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    // Previous month (Dec 2025): 6 active seats × 300 = 1800
    expect(json.previousIncludedPremiumRequests).toBe(1800);
    expect(json.previousIncludedPremiumRequestsUsed).toBe(500);
  });

  it("returns null previous month data in empty-state response", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "6", year: "2025" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.previousIncludedPremiumRequests).toBeNull();
    expect(json.previousIncludedPremiumRequestsUsed).toBeNull();
  });

  it("dailyUsage is empty array when summary exists but no copilot_usage rows", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.dailyUsage).toEqual([]);
  });

  it("dailyUsage aggregates across multiple seats for the same day", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat1 = await seedSeat({ githubUsername: "user-a" });
    const seat2 = await seedSeat({ githubUsername: "user-b" });

    await seedUsage({
      seatId: seat1.id,
      day: 5,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 100, grossAmount: 10, netAmount: 8, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 100 },
      ],
    });
    await seedUsage({
      seatId: seat2.id,
      day: 5,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 50, grossAmount: 5, netAmount: 4, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 50 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.dailyUsage).toHaveLength(1);
    expect(json.dailyUsage[0].day).toBe(5);
    expect(json.dailyUsage[0].totalRequests).toBe(150);
  });

  it("dailyUsage returns separate entries per day ordered by day ASC", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat = await seedSeat({ githubUsername: "user-c" });

    await seedUsage({
      seatId: seat.id,
      day: 10,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 30, grossAmount: 3, netAmount: 2, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 30 },
      ],
    });
    await seedUsage({
      seatId: seat.id,
      day: 3,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 20, grossAmount: 2, netAmount: 1, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 20 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.dailyUsage).toHaveLength(2);
    expect(json.dailyUsage[0]).toEqual({ day: 3, totalRequests: 20 });
    expect(json.dailyUsage[1]).toEqual({ day: 10, totalRequests: 30 });
  });

  it("dailyUsage is empty array in empty-state response (no summary)", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "6", year: "2025" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.dailyUsage).toEqual([]);
  });

  it("previousDailyUsage is empty array when summary exists but no copilot_usage rows for previous month", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat = await seedSeat({ githubUsername: "user-current" });
    await seedUsage({
      seatId: seat.id,
      day: 5,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 100, grossAmount: 10, netAmount: 8, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 100 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.dailyUsage).toHaveLength(1);
    expect(json.previousDailyUsage).toEqual([]);
  });

  it("previousDailyUsage returns aggregated data for the previous month", async () => {
    await seedAuthSession();
    await seedSummary({ month: 3, year: 2026 });

    const seat1 = await seedSeat({ githubUsername: "user-prev-a" });
    const seat2 = await seedSeat({ githubUsername: "user-prev-b" });

    // Previous month usage (February 2026)
    await seedUsage({
      seatId: seat1.id,
      day: 10,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 80, grossAmount: 8, netAmount: 6, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 80 },
      ],
    });
    await seedUsage({
      seatId: seat2.id,
      day: 10,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 40, grossAmount: 4, netAmount: 3, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 40 },
      ],
    });
    await seedUsage({
      seatId: seat1.id,
      day: 15,
      month: 2,
      year: 2026,
      usageItems: [
        { grossQuantity: 60, grossAmount: 6, netAmount: 5, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 60 },
      ],
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.previousDailyUsage).toHaveLength(2);
    expect(json.previousDailyUsage[0]).toEqual({ day: 10, totalRequests: 120 });
    expect(json.previousDailyUsage[1]).toEqual({ day: 15, totalRequests: 60 });
  });

  it("previousDailyUsage handles year boundary — January returns December of previous year", async () => {
    await seedAuthSession();
    await seedSummary({ month: 1, year: 2026 });

    const seat = await seedSeat({ githubUsername: "user-dec" });
    await seedUsage({
      seatId: seat.id,
      day: 20,
      month: 12,
      year: 2025,
      usageItems: [
        { grossQuantity: 200, grossAmount: 20, netAmount: 16, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 200 },
      ],
    });

    const request = makeGetRequest({ month: "1", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.previousDailyUsage).toHaveLength(1);
    expect(json.previousDailyUsage[0]).toEqual({ day: 20, totalRequests: 200 });
  });

  it("previousDailyUsage is empty array in empty-state response", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "6", year: "2025" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.previousDailyUsage).toEqual([]);
  });

  it("topDailySpendings is empty array when summary exists but no copilot_usage rows", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toEqual([]);
  });

  it("topDailySpendings returns entries sorted by spending DESC", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat1 = await seedSeat({ githubUsername: "low-spender", firstName: "Low", lastName: "Spender" });
    const seat2 = await seedSeat({ githubUsername: "mid-spender", firstName: "Mid", lastName: "Spender" });
    const seat3 = await seedSeat({ githubUsername: "high-spender", firstName: "High", lastName: "Spender" });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 10, grossAmount: 5, netAmount: 5, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 10 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 2, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 20, grossAmount: 15, netAmount: 15, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 20 }],
    });
    await seedUsage({
      seatId: seat3.id, day: 3, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 30, grossAmount: 30, netAmount: 30, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 30 }],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toHaveLength(3);
    expect(json.topDailySpendings[0].totalSpending).toBe(30);
    expect(json.topDailySpendings[1].totalSpending).toBe(15);
    expect(json.topDailySpendings[2].totalSpending).toBe(5);
  });

  it("topDailySpendings limits to 10 entries", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    // Create 12 seats with usage on different days
    for (let i = 1; i <= 12; i++) {
      const seat = await seedSeat({ githubUsername: `user-${i}` });
      await seedUsage({
        seatId: seat.id, day: i, month: 2, year: 2026,
        usageItems: [{ grossQuantity: 10, grossAmount: i, netAmount: i, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 10 }],
      });
    }

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toHaveLength(10);
  });

  it("topDailySpendings sums netAmount across multiple usage items for same seat-day", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat = await seedSeat({ githubUsername: "multi-item-user", firstName: "Multi", lastName: "Item" });
    await seedUsage({
      seatId: seat.id, day: 5, month: 2, year: 2026,
      usageItems: [
        { grossQuantity: 10, grossAmount: 10, netAmount: 10, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 10 },
        { grossQuantity: 5, grossAmount: 5, netAmount: 5, model: "Claude Sonnet 4.5", product: "chat", sku: "sku2", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 5 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toHaveLength(1);
    expect(json.topDailySpendings[0].totalSpending).toBe(15);
  });

  it("topDailySpendings includes user display info from copilot_seat", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat = await seedSeat({ githubUsername: "jdoe", firstName: "John", lastName: "Doe" });
    await seedUsage({
      seatId: seat.id, day: 7, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 10, grossAmount: 20, netAmount: 20, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 10 }],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toHaveLength(1);
    const entry = json.topDailySpendings[0];
    expect(entry.seatId).toBe(seat.id);
    expect(entry.githubUsername).toBe("jdoe");
    expect(entry.displayName).toBe("John Doe");
    expect(entry.day).toBe(7);
    expect(entry.totalSpending).toBe(20);
  });

  it("topDailySpendings is empty array in empty-state response (no summary)", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "6", year: "2025" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toEqual([]);
  });

  it("topDailySpendings allows same user on multiple days", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat = await seedSeat({ githubUsername: "multi-day-user", firstName: "Multi", lastName: "Day" });
    await seedUsage({
      seatId: seat.id, day: 1, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 10, grossAmount: 10, netAmount: 10, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 10 }],
    });
    await seedUsage({
      seatId: seat.id, day: 2, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 20, grossAmount: 25, netAmount: 25, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 20 }],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toHaveLength(2);
    // Both entries should be for the same seat
    expect(json.topDailySpendings[0].seatId).toBe(seat.id);
    expect(json.topDailySpendings[1].seatId).toBe(seat.id);
    // Sorted by spending DESC
    expect(json.topDailySpendings[0].totalSpending).toBe(25);
    expect(json.topDailySpendings[1].totalSpending).toBe(10);
  });

  it("topDailySpendings uses githubUsername as fallback when no name", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const seat = await seedSeat({ githubUsername: "no-name-user" });
    await seedUsage({
      seatId: seat.id, day: 3, month: 2, year: 2026,
      usageItems: [{ grossQuantity: 10, grossAmount: 8, netAmount: 8, model: "GPT-4o", product: "chat", sku: "sku1", unitType: "request", pricePerUnit: 0.1, discountQuantity: 0, discountAmount: 0, netQuantity: 10 }],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.topDailySpendings).toHaveLength(1);
    expect(json.topDailySpendings[0].displayName).toBe("no-name-user");
    expect(json.topDailySpendings[0].githubUsername).toBe("no-name-user");
  });
});
