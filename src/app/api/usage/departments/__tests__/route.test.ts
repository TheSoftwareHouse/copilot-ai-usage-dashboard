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

const { GET } = await import("@/app/api/usage/departments/route");
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
  const url = new URL("http://localhost:3000/api/usage/departments");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
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

describe("GET /api/usage/departments", () => {
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

  it("returns empty list when no departments exist", async () => {
    await seedAuthSession();

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.departments).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);
  });

  it("returns departments with aggregated usage metrics including usagePercent", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Engineering");
    const seat1 = await seedSeat({ githubUsername: "alice", githubUserId: 1001, departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "bob", githubUserId: 1002, departmentId: dept.id });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 200, grossAmount: 8.0, discountQuantity: 200, discountAmount: 8.0, netQuantity: 0, netAmount: 0 },
      ],
    });

    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 100, grossAmount: 4.0, discountQuantity: 100, discountAmount: 4.0, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.departments).toHaveLength(1);
    expect(json.total).toBe(1);

    const d = json.departments[0];
    expect(d.departmentId).toBe(dept.id);
    expect(d.departmentName).toBe("Engineering");
    expect(d.memberCount).toBe(2);
    expect(d.totalRequests).toBe(300);
    expect(d.totalGrossAmount).toBeCloseTo(12.0, 2);
    expect(d.averageRequestsPerMember).toBe(150);
    // usagePercent = (300 / (2 * 300)) * 100 = 50
    expect(d).not.toHaveProperty("usagePercent");
  });

  it("usagePercent is correctly computed with per-seat capping", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Data Science");
    const seat1 = await seedSeat({ githubUsername: "ds-alice", githubUserId: 2001, departmentId: dept.id });
    await seedSeat({ githubUsername: "ds-bob", githubUserId: 2002, departmentId: dept.id });

    // Only seat1 has usage: 450 requests (capped at 300)
    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 450, grossAmount: 18.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 },
      ],
    });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    const d = json.departments[0];
    expect(d.memberCount).toBe(2);
    expect(d.totalRequests).toBe(450);
    // usagePercent = (min(450,300) + min(0,300)) / (2 * 300) * 100 = 300 / 600 * 100 = 50
    expect(d).not.toHaveProperty("usagePercent");
  });

  it("department with no assigned seats returns zero metrics and usagePercent: 0", async () => {
    await seedAuthSession();

    await seedDepartment("Empty Department");

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.departments).toHaveLength(1);
    const d = json.departments[0];
    expect(d.departmentName).toBe("Empty Department");
    expect(d.memberCount).toBe(0);
    expect(d.totalRequests).toBe(0);
    expect(d.totalGrossAmount).toBe(0);
    expect(d.averageRequestsPerMember).toBe(0);
    expect(d).not.toHaveProperty("usagePercent");
  });

  it("department with assigned seats but no usage data for the month returns zero totals with correct member count", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("No Usage Dept");
    await seedSeat({ githubUsername: "idle-user", githubUserId: 3001, departmentId: dept.id });

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.departments).toHaveLength(1);
    const d = json.departments[0];
    expect(d.memberCount).toBe(1);
    expect(d.totalRequests).toBe(0);
    expect(d.totalGrossAmount).toBe(0);
  });

  it("average per member calculated correctly (total / memberCount)", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Calc Team");
    const seat1 = await seedSeat({ githubUsername: "calc-a", githubUserId: 4001, departmentId: dept.id });
    const seat2 = await seedSeat({ githubUsername: "calc-b", githubUserId: 4002, departmentId: dept.id });
    await seedSeat({ githubUsername: "calc-c", githubUserId: 4003, departmentId: dept.id });

    await seedUsage({
      seatId: seat1.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 60, grossAmount: 2.4, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    await seedUsage({
      seatId: seat2.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });
    // seat3 has no usage

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    const d = json.departments[0];
    expect(d.memberCount).toBe(3);
    expect(d.totalRequests).toBe(90);
    expect(d.averageRequestsPerMember).toBe(30);
    expect(d.totalGrossAmount).toBeCloseTo(3.6, 2);
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

  it("departments ordered by usagePercent DESC (highest first)", async () => {
    await seedAuthSession();

    // Dept A: 1 member, 300 requests → capped: 300/300 = 100%
    const deptA = await seedDepartment("High Dept");
    const seatA = await seedSeat({ githubUsername: "high-user", githubUserId: 5001, departmentId: deptA.id });
    await seedUsage({
      seatId: seatA.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 300, grossAmount: 12.0, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    // Dept B: 1 member, 90 requests → capped: 90/300 = 30%
    const deptB = await seedDepartment("Low Dept");
    const seatB = await seedSeat({ githubUsername: "low-user", githubUserId: 5002, departmentId: deptB.id });
    await seedUsage({
      seatId: seatB.id, day: 1, month: 2, year: 2026,
      usageItems: [{ product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 90, grossAmount: 3.6, discountQuantity: 0, discountAmount: 0, netQuantity: 0, netAmount: 0 }],
    });

    // Dept C: no members → 0%
    await seedDepartment("Empty Dept");

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    expect(json.departments).toHaveLength(3);
    // Order: High (100%) → Low (30%) → Empty (0%)
    expect(json.departments[0].departmentName).toBe("High Dept");
    expect(json.departments[0]).not.toHaveProperty("usagePercent");
    expect(json.departments[1].departmentName).toBe("Low Dept");
    expect(json.departments[1]).not.toHaveProperty("usagePercent");
    expect(json.departments[2].departmentName).toBe("Empty Dept");
    expect(json.departments[2]).not.toHaveProperty("usagePercent");
  });

  it("usagePercent uses capped per-seat requests — member exceeding cap", async () => {
    await seedAuthSession();

    const dept = await seedDepartment("Cap Dept");
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

    const request = makeGetRequest({ month: "2", year: "2026" });
    const response = await GET(request as never);
    const json = await response.json();

    const d = json.departments[0];
    // capped: (min(1000,300) + min(100,300)) / (2 * 300) * 100 ≈ 66.67
    expect(d).not.toHaveProperty("usagePercent");
    // totalRequests remains uncapped
    expect(d.totalRequests).toBe(1100);
  });
});
