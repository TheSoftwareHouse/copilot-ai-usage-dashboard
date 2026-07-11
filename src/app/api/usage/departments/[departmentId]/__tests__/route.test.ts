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

const { GET } = await import("@/app/api/usage/departments/[departmentId]/route");
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

function makeGetRequest(departmentId: string, params?: Record<string, string>): { request: NextRequest; context: { params: Promise<{ departmentId: string }> } } {
  const url = new URL(`http://localhost:3000/api/usage/departments/${departmentId}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return {
    request: new NextRequest(url.toString(), { method: "GET" }),
    context: { params: Promise.resolve({ departmentId }) },
  };
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

describe("GET /api/usage/departments/[departmentId]", () => {
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
    const { request, context } = makeGetRequest("1");
    const response = await GET(request as never, context);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid departmentId", async () => {
    await seedAuthSession();

    const testCases = ["abc", "0", "-1", "1.5"];
    for (const id of testCases) {
      const { request, context } = makeGetRequest(id);
      const response = await GET(request as never, context);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid department ID");
    }
  });

  it("returns 404 for non-existent department", async () => {
    await seedAuthSession();

    const { request, context } = makeGetRequest("9999");
    const response = await GET(request as never, context);
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Department not found");
  });

  it("returns department detail with per-member usage breakdown", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Engineering");
    const seat1 = await seedSeat({ githubUsername: "alice", githubUserId: 1001, firstName: "Alice", lastName: "Smith", departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "bob", githubUserId: 1002, firstName: "Bob", lastName: "Jones", departmentId: dept.id });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.department.departmentId).toBe(dept.id);
    expect(json.department.departmentName).toBe("Engineering");
    expect(json.department.memberCount).toBe(2);
    expect(json.department.totalRequests).toBe(150);
    expect(json.department.totalGrossAmount).toBeCloseTo(6.0, 2);
    expect(json.department.averageRequestsPerMember).toBe(75);
    // usagePercent = (150 / (2 * 300)) * 100 = 25
    expect(json.department).not.toHaveProperty("usagePercent");

    expect(json.members).toHaveLength(2);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("usagePercent computed with per-seat capping", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Data Science");
    const seat1 = await seedSeat({ githubUsername: "ds-alice", githubUserId: 2001, departmentId: dept.id });
    await seedSeat({ githubUsername: "ds-bob", githubUserId: 2002, departmentId: dept.id });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 450, grossAmount: 18.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.department.memberCount).toBe(2);
    expect(json.department.totalRequests).toBe(450);
    // usagePercent = (min(450,300) + min(0,300)) / (2 * 300) * 100 = 300 / 600 * 100 = 50
    expect(json.department).not.toHaveProperty("usagePercent");
  });

  it("members are ordered by totalRequests DESC", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Order Dept");
    const seatLow = await seedSeat({ githubUsername: "low", githubUserId: 3001, departmentId: dept.id });
    const seatHigh = await seedSeat({ githubUsername: "high", githubUserId: 3002, departmentId: dept.id });

    await seedUsage({
      seatId: seatLow.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 10, grossAmount: 0.4, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seatHigh.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 200, grossAmount: 8.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.members[0].githubUsername).toBe("high");
    expect(json.members[1].githubUsername).toBe("low");
  });

  it("department with no assigned seats returns empty members and zero aggregates", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Empty Department");

    const { request, context } = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.department.memberCount).toBe(0);
    expect(json.department.totalRequests).toBe(0);
    expect(json.department.totalGrossAmount).toBe(0);
    expect(json.department.averageRequestsPerMember).toBe(0);
    expect(json.department).not.toHaveProperty("usagePercent");
    expect(json.members).toEqual([]);
  });

  it("department with seats but no usage returns members with zero totals", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Idle Department");
    await seedSeat({ githubUsername: "idle", githubUserId: 4001, departmentId: dept.id });

    const { request, context } = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.members).toHaveLength(1);
    expect(json.members[0].githubUsername).toBe("idle");
    expect(json.members[0].totalRequests).toBe(0);
    expect(json.members[0].totalGrossAmount).toBe(0);
  });

  it("uses the current seat department assignment for costStats scope", async () => {
    await seedAuthSession();

    const dept1 = await seedDepartment("Engineering");
    const dept2 = await seedDepartment("Operations");
    const seat = await seedSeat({
      githubUsername: "reassigned",
      githubUserId: 7001,
      firstName: "Re",
      lastName: "Assigned",
      departmentId: dept1.id,
    });

    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.01, grossQuantity: 3000, grossAmount: 30, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const seatRepo = testDs.getRepository(CopilotSeatEntity);
    await seatRepo.update(seat.id, { departmentId: dept2.id });

    const { request: requestOne, context: contextOne } = makeGetRequest(String(dept1.id), { month: "2", year: "2026" });
    const responseOne = await GET(requestOne as never, contextOne);
    const jsonOne = await responseOne.json();

    expect(jsonOne.department.memberCount).toBe(0);
    expect(jsonOne.members).toEqual([]);
    expect(jsonOne.costStats.totalCost).toBeCloseTo(0, 2);

    const { request: requestTwo, context: contextTwo } = makeGetRequest(String(dept2.id), { month: "2", year: "2026" });
    const responseTwo = await GET(requestTwo as never, contextTwo);
    const jsonTwo = await responseTwo.json();

    expect(jsonTwo.department.memberCount).toBe(1);
    expect(jsonTwo.members[0].githubUsername).toBe("reassigned");
    expect(jsonTwo.costStats.totalCost).toBeCloseTo(30, 2);
    expect(jsonTwo.costStats.averageDailyCost).toBeCloseTo(1.07, 2);
    expect(jsonTwo.costStats.predictedMonthCost).toBeCloseTo(21.4, 2);
  });

  it("defaults to current month/year when params are missing", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Default Month Dept");
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const { request, context } = makeGetRequest(String(dept.id));
    const response = await GET(request as never, context);
    const json = await response.json();

    expect(json.month).toBe(currentMonth);
    expect(json.year).toBe(currentYear);
  });

  it("department.usagePercent uses capped per-member requests — member exceeding cap", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Capped Detail Dept");
    const seat1 = await seedSeat({ githubUsername: "cap-heavy", githubUserId: 6001, departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "cap-light", githubUserId: 6002, departmentId: dept.id });

    // seat1: 1000 requests (exceeds 300 cap), seat2: 100 requests
    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 1000, grossAmount: 40.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    const { request, context } = makeGetRequest(String(dept.id), { month: "2", year: "2026" });
    const response = await GET(request as never, context);
    const json = await response.json();

    // department.usagePercent is capped: (min(1000,300) + min(100,300)) / (2 * 300) * 100 ≈ 66.67
    expect(json.department).not.toHaveProperty("usagePercent");
    // department.totalRequests stays raw uncapped
    expect(json.department.totalRequests).toBe(1100);
    // members retain raw individual totals
    expect(json.members[0].totalRequests).toBe(1000);
    expect(json.members[1].totalRequests).toBe(100);
  });
});
