/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import type { CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity } from "@/entities/copilot-usage.entity";
import type { CopilotUsage } from "@/entities/copilot-usage.entity";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import type { DashboardMonthlySummary } from "@/entities/dashboard-monthly-summary.entity";
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

const { GET } = await import("@/app/api/dashboard/months/route");
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

async function seedSummary(
  overrides: Partial<DashboardMonthlySummary> & { month: number; year: number },
): Promise<DashboardMonthlySummary> {
  const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
  return repo.save({
    totalSeats: 10,
    activeSeats: 8,
    totalSpending: 500.0,
    seatBaseCost: 152.0,
    totalAiCredits: 1200,
    modelUsage: [],
    mostActiveUsers: [],
    leastActiveUsers: [],
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

describe("GET /api/dashboard/months", () => {
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

  it("returns 401 when not authenticated", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns empty array when no summary rows exist", async () => {
    await seedAuthSession();

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.months).toEqual([]);
  });

  it("returns all available (month, year) pairs when summary rows exist", async () => {
    await seedAuthSession();
    await seedSummary({ month: 1, year: 2026 });
    await seedSummary({ month: 2, year: 2026 });
    await seedSummary({ month: 12, year: 2025 });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.months).toHaveLength(3);

    // Verify all three months are present
    const monthKeys = json.months.map(
      (m: { month: number; year: number }) => `${m.month}-${m.year}`,
    );
    expect(monthKeys).toContain("1-2026");
    expect(monthKeys).toContain("2-2026");
    expect(monthKeys).toContain("12-2025");
  });

  it("includes May 2026+ months discovered from raw usage even without summaries", async () => {
    await seedAuthSession();

    const seat = await seedSeat({ githubUsername: "octocat" });
    await seedUsage({
      seatId: seat.id,
      day: 2,
      month: 5,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "AIC",
          model: "GPT-4o",
          unitType: "requests",
          pricePerUnit: 0.5,
          grossQuantity: 2,
          grossAmount: 1,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 0,
          netAmount: 0,
        },
      ],
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.months).toContainEqual({ month: 5, year: 2026 });
  });

  it("does not add pre-May 2026 raw usage months without summaries", async () => {
    await seedAuthSession();

    const seat = await seedSeat({ githubUsername: "legacy-user" });
    await seedUsage({
      seatId: seat.id,
      day: 2,
      month: 4,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "AIC",
          model: "GPT-4o",
          unitType: "requests",
          pricePerUnit: 0.5,
          grossQuantity: 2,
          grossAmount: 1,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 0,
          netAmount: 0,
        },
      ],
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.months).not.toContainEqual({ month: 4, year: 2026 });
  });

  it("returns results sorted newest-first (year DESC, month DESC)", async () => {
    await seedAuthSession();
    await seedSummary({ month: 1, year: 2026 });
    await seedSummary({ month: 12, year: 2025 });
    await seedSummary({ month: 2, year: 2026 });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.months[0]).toEqual({ month: 2, year: 2026 });
    expect(json.months[1]).toEqual({ month: 1, year: 2026 });
    expect(json.months[2]).toEqual({ month: 12, year: 2025 });
  });

  it("returns response with expected structure { months: [{ month, year }] }", async () => {
    await seedAuthSession();
    await seedSummary({ month: 2, year: 2026 });

    const response = await GET();
    const json = await response.json();

    expect(json).toHaveProperty("months");
    expect(Array.isArray(json.months)).toBe(true);
    expect(json.months[0]).toHaveProperty("month");
    expect(json.months[0]).toHaveProperty("year");
    expect(typeof json.months[0].month).toBe("number");
    expect(typeof json.months[0].year).toBe("number");
  });
});
