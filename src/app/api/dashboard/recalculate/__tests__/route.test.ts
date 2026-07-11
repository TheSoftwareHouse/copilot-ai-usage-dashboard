/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { SeatStatus } from "@/entities/enums";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import type { DashboardMonthlySummary } from "@/entities/dashboard-monthly-summary.entity";
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

const { POST } = await import("@/app/api/dashboard/recalculate/route");
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

function makePostRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/dashboard/recalculate");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "POST" });
}

async function seedSeat(
  username: string,
  status: SeatStatus = SeatStatus.ACTIVE,
): Promise<number> {
  const repo = testDs.getRepository(CopilotSeatEntity);
  const seat = await repo.save({
    githubUsername: username,
    githubUserId: Math.floor(Math.random() * 100000),
    status,
  });
  return seat.id;
}

function makeUsageItem(
  model: string,
  grossQuantity: number,
  grossAmount: number,
  discountQuantity: number = 0,
  discountAmount: number = 0,
) {
  return {
    product: "Copilot",
    sku: "Copilot Premium Request",
    model,
    unitType: "requests",
    pricePerUnit: grossQuantity > 0 ? grossAmount / grossQuantity : 0,
    grossQuantity,
    grossAmount,
    discountQuantity,
    discountAmount,
    netQuantity: grossQuantity - discountQuantity,
    netAmount: grossAmount - discountAmount,
  };
}

async function seedUsage(
  seatId: number,
  day: number,
  month: number,
  year: number,
  usageItems: CopilotUsage["usageItems"],
): Promise<void> {
  const repo = testDs.getRepository(CopilotUsageEntity);
  await repo.save({
    seatId,
    day,
    month,
    year,
    usageItems,
  } as Partial<CopilotUsage>);
}

async function seedStaleSummary(
  overrides: Partial<DashboardMonthlySummary> & { month: number; year: number },
): Promise<void> {
  const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
  await repo.save({
    totalSeats: 2,
    activeSeats: 2,
    totalSpending: 999.0,
    seatBaseCost: 0,
    totalAiCredits: 100,
    modelUsage: [],
    mostActiveUsers: [],
    leastActiveUsers: [],
    ...overrides,
  } as Partial<DashboardMonthlySummary>);
}

describe("POST /api/dashboard/recalculate", () => {
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
    const request = makePostRequest();
    const response = await POST(request as never);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("skips pre-May 2026 months and recalculates supported months when no params are provided", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat("user-1");
    const seat2 = await seedSeat("user-2");

    await seedUsage(seat1, 1, 4, 2026, [
      makeUsageItem("GPT-4o", 100, 10.0),
    ]);
    await seedUsage(seat2, 1, 5, 2026, [
      makeUsageItem("GPT-4o", 200, 20.0),
    ]);

    const request = makePostRequest();
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.total).toBe(1);
    expect(json.recalculatedMonths).toEqual([{ month: 5, year: 2026 }]);
    expect(json.skippedHistoricalMonths).toEqual([{ month: 4, year: 2026 }]);

    const summaryRepo = testDs.getRepository(DashboardMonthlySummaryEntity);

    const apr = await summaryRepo.findOne({ where: { month: 4, year: 2026 } });
    expect(apr).toBeNull();

    const may = await summaryRepo.findOne({ where: { month: 5, year: 2026 } });
    expect(may).not.toBeNull();
    expect(Number(may!.seatBaseCost)).toBe(38);
    expect(Number(may!.totalSpending)).toBe(58);
  });

  it("returns 409 for a pre-May 2026 month filter", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat("user-1");

    await seedUsage(seat1, 1, 1, 2026, [
      makeUsageItem("GPT-4o", 100, 10.0, 50, 5.0),
    ]);
    await seedUsage(seat1, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 200, 20.0, 100, 10.0),
    ]);

    const request = makePostRequest({ month: "4", year: "2026" });
    const response = await POST(request as never);
    expect(response.status).toBe(409);
    const json = await response.json();

    expect(json.error).toBe(
      "Selected historical period is read-only under the AIC Credits reporting policy",
    );

    const summaryRepo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const apr = await summaryRepo.findOne({ where: { month: 4, year: 2026 } });
    expect(apr).toBeNull();
  });

  it("recalculates a supported month when month and year params are provided", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat("user-1");

    await seedUsage(seat1, 1, 5, 2026, [
      makeUsageItem("GPT-4o", 100, 10.0),
    ]);

    const request = makePostRequest({ month: "5", year: "2026" });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.total).toBe(1);
    expect(json.recalculatedMonths).toEqual([{ month: 5, year: 2026 }]);

    const summaryRepo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const may = await summaryRepo.findOne({ where: { month: 5, year: 2026 } });
    expect(may).not.toBeNull();
    expect(Number(may!.seatBaseCost)).toBe(19);
    expect(may!.totalAiCredits).toBe(100);
  });

  it("returns 400 for invalid month parameter", async () => {
    await seedAuthSession();

    const request = makePostRequest({ month: "13", year: "2026" });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Invalid month");
  });

  it("returns 400 for invalid year parameter", async () => {
    await seedAuthSession();

    const request = makePostRequest({ month: "1", year: "abc" });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Invalid year");
  });

  it("returns 400 when only month is provided without year", async () => {
    await seedAuthSession();

    const request = makePostRequest({ month: "1" });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Both month and year");
  });

  it("returns 400 when only year is provided without month", async () => {
    await seedAuthSession();

    const request = makePostRequest({ year: "2026" });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Both month and year");
  });

  it("returns empty recalculatedMonths when no data exists", async () => {
    await seedAuthSession();

    const request = makePostRequest();
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.total).toBe(0);
    expect(json.recalculatedMonths).toEqual([]);
  });

  it("correctly updates stale summary data with netAmount-based values", async () => {
    await seedAuthSession();

    const seat1 = await seedSeat("user-1");
    const seat2 = await seedSeat("user-2");

    // Seed usage: gross=50, discount=50, net=0 (fully discounted)
    await seedUsage(seat1, 1, 5, 2026, [
      makeUsageItem("GPT-4o", 300, 50.0, 300, 50.0),
    ]);
    await seedUsage(seat2, 1, 5, 2026, [
      makeUsageItem("GPT-4o", 200, 30.0, 200, 30.0),
    ]);

    await seedStaleSummary({
      month: 5,
      year: 2026,
      totalSpending: 80.0,
      seatBaseCost: 0,
    });

    const request = makePostRequest({ month: "5", year: "2026" });
    const response = await POST(request as never);
    expect(response.status).toBe(200);

    const summaryRepo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await summaryRepo.findOne({ where: { month: 5, year: 2026 } });

    // grossAmount = 50 + 30 = 80, seatBaseCost = 2 active × $19 = 38
    // totalSpending = 80 + 38 = 118
    expect(Number(summary!.seatBaseCost)).toBe(38);
    expect(Number(summary!.totalSpending)).toBe(118);
  });

  it("seatBaseCost reflects current active seat count × 19", async () => {
    await seedAuthSession();

    // 3 active, 1 inactive
    const seat1 = await seedSeat("user-1", SeatStatus.ACTIVE);
    await seedSeat("user-2", SeatStatus.ACTIVE);
    await seedSeat("user-3", SeatStatus.ACTIVE);
    await seedSeat("user-4", SeatStatus.INACTIVE);

    await seedUsage(seat1, 1, 5, 2026, [
      makeUsageItem("GPT-4o", 10, 1.0, 5, 0.5),
    ]);

    const request = makePostRequest({ month: "5", year: "2026" });
    const response = await POST(request as never);
    expect(response.status).toBe(200);

    const summaryRepo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await summaryRepo.findOne({ where: { month: 5, year: 2026 } });

    // 3 active seats × $19 = $57
    expect(Number(summary!.seatBaseCost)).toBe(57);
    // grossAmount = 1.0, totalSpending = 1.0 + 57 = 58.0
    expect(Number(summary!.totalSpending)).toBe(58);
  });
});
