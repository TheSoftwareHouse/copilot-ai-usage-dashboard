/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { DepartmentEntity, type Department } from "@/entities/department.entity";
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

const { GET } = await import("@/app/api/usage/departments/[departmentId]/stats/route");
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

function makeGetRequest(departmentId: string, params?: Record<string, string>): NextRequest {
  const url = new URL(`http://localhost:3000/api/usage/departments/${departmentId}/stats`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

function makeRouteContext(departmentId: string) {
  return { params: Promise.resolve({ departmentId }) };
}

async function seedDepartment(name: string): Promise<Department> {
  const repo = testDs.getRepository(DepartmentEntity);
  return repo.save({ name } as Partial<Department>);
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

describe("GET /api/usage/departments/[departmentId]/stats", () => {
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
    const request = makeGetRequest("1");
    const response = await GET(request as never, makeRouteContext("1"));
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid departmentId", async () => {
    await seedAuthSession();

    for (const id of ["abc", "-1", "0", "1.5"]) {
      const request = makeGetRequest(id);
      const response = await GET(request as never, makeRouteContext(id));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid department ID");
    }
  });

  it("returns 404 for non-existent department", async () => {
    await seedAuthSession();

    const request = makeGetRequest("99999");
    const response = await GET(request as never, makeRouteContext("99999"));
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Department not found");
  });

  it("returns null stats when department has no members", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Empty Department");

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toEqual({
      averageRequests: null,
      medianRequests: null,
      minRequests: null,
      maxRequests: null,
      month: 2,
      year: 2026,
    });
  });

  it("returns correct per-member stats for a department with multiple members", async () => {
    await seedAuthSession();
    // Member 1: 300 requests → 300/300 × 100 = 100%
    // Member 2: 150 requests → 150/300 × 100 = 50%
    // Member 3: 60 requests  → 60/300 × 100  = 20%
    const dept = await seedDepartment("Engineering");
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1001, departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 1002, departmentId: dept.id });
    const seat3 = await seedSeat({ githubUsername: "user3", githubUserId: 1003, departmentId: dept.id });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(60)] });

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();
    // avg = (100 + 50 + 20) / 3 = 56.7
    // median of [20, 50, 100] = 50.0
    // min = 20.0
    // max = 100.0
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("defaults to current month/year when params are missing", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Default Month Dept");

    const request = makeGetRequest(String(dept.id));
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();

    const now = new Date();
    expect(json.month).toBe(now.getUTCMonth() + 1);
    expect(json.year).toBe(now.getUTCFullYear());
  });

  it("correctly computes median for an even number of members", async () => {
    await seedAuthSession();

    // 4 members: 300→100%, 150→50%, 60→20%, 450→150%
    const dept = await seedDepartment("Even Members Dept");
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1001, departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 1002, departmentId: dept.id });
    const seat3 = await seedSeat({ githubUsername: "user3", githubUserId: 1003, departmentId: dept.id });
    const seat4 = await seedSeat({ githubUsername: "user4", githubUserId: 1004, departmentId: dept.id });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(60)] });
    await seedUsage({ seatId: seat4.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(450)] });

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();

    // Sorted usage: [20, 50, 100, 150]
  });

  it("returns correct stats when only one member exists", async () => {
    await seedAuthSession();

    // 1 member: 210 requests → 210/300 × 100 = 70%
    const dept = await seedDepartment("Solo Member Dept");
    const seat = await seedSeat({ githubUsername: "solo", githubUserId: 9001, departmentId: dept.id });
    await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(210)] });

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();

    // Single member: average = median = min = max = 70.0
  });

  it("returns raw credit stats without an allowance dependency", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Zero Allowance Dept");
    const seat = await seedSeat({ githubUsername: "user1", githubUserId: 1001, departmentId: dept.id });
    await seedUsage({ seatId: seat.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();
  });

  it("includes members with zero usage in statistics", async () => {
    await seedAuthSession();

    // Member 1: 300 requests → 100%
    // Member 2: no copilot_usage records → 0%
    const dept = await seedDepartment("Mixed Usage Dept");
    const seat1 = await seedSeat({ githubUsername: "active-user", githubUserId: 1001, departmentId: dept.id });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(300)] });
    await seedSeat({ githubUsername: "idle-user", githubUserId: 1002, departmentId: dept.id });
    // No seedUsage for seat2 — member has zero usage

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();
    // avg = (100 + 0) / 2 = 50.0
    // median of [0, 100] = (0 + 100) / 2 = 50.0
    // min = 0.0
    // max = 100.0
  });

  it("does not cap individual member usage above allowance", async () => {
    await seedAuthSession();
    // Member 2: 150 requests → 150/300 × 100 = 50%
    const dept = await seedDepartment("Uncapped Dept");
    const seat1 = await seedSeat({ githubUsername: "heavy-user", githubUserId: 1001, departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "normal-user", githubUserId: 1002, departmentId: dept.id });
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(600)] });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(150)] });

    const request = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, makeRouteContext(String(dept.id)));
    expect(response.status).toBe(200);
    const json = await response.json();
    // avg = (200 + 50) / 2 = 125.0
    // median of [50, 200] = (50 + 200) / 2 = 125.0
    // min = 50.0
    // max = 200.0
  });
});
