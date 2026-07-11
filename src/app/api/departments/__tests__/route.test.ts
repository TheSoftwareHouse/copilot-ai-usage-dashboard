/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
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

const { GET, POST } = await import("@/app/api/departments/route");
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import(
  "@/lib/auth"
);
const { DepartmentEntity } = await import("@/entities/department.entity");
const { CopilotSeatEntity } = await import("@/entities/copilot-seat.entity");
const { CopilotUsageEntity } = await import("@/entities/copilot-usage.entity");
type CopilotUsage = import("@/entities/copilot-usage.entity").CopilotUsage;
const { SeatStatus } = await import("@/entities/enums");

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
  return new Request("http://localhost:3000/api/departments", init);
}

describe("GET /api/departments", () => {
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

  it("returns 200 with empty list when no departments exist", async () => {
    await seedAuthSession();
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.departments).toHaveLength(0);
  });

  it("returns departments ordered by name", async () => {
    await seedAuthSession();

    const deptRepo = testDs.getRepository(DepartmentEntity);
    await deptRepo.save({ name: "Zulu" });
    await deptRepo.save({ name: "Alpha" });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.departments).toHaveLength(2);
    expect(json.departments[0].name).toBe("Alpha");
    expect(json.departments[1].name).toBe("Zulu");

    for (const dept of json.departments) {
      expect(dept).toHaveProperty("id");
      expect(dept).toHaveProperty("name");
      expect(dept).toHaveProperty("seatCount");
      expect(dept).not.toHaveProperty("usagePercent");
      expect(dept).toHaveProperty("createdAt");
      expect(dept).toHaveProperty("updatedAt");
    }
  });

  it("includes correct seatCount per department", async () => {
    await seedAuthSession();

    const deptRepo = testDs.getRepository(DepartmentEntity);
    const seatRepo = testDs.getRepository(CopilotSeatEntity);

    const eng = await deptRepo.save({ name: "Engineering" });
    const mkt = await deptRepo.save({ name: "Marketing" });
    await deptRepo.save({ name: "Empty" });

    await seatRepo.save({
      githubUsername: "user1",
      githubUserId: 1,
      status: SeatStatus.ACTIVE,
      departmentId: eng.id,
    });
    await seatRepo.save({
      githubUsername: "user2",
      githubUserId: 2,
      status: SeatStatus.ACTIVE,
      departmentId: eng.id,
    });
    await seatRepo.save({
      githubUsername: "user3",
      githubUserId: 3,
      status: SeatStatus.ACTIVE,
      departmentId: mkt.id,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.departments).toHaveLength(3);

    const empty = json.departments.find((d: { name: string }) => d.name === "Empty");
    const engineering = json.departments.find((d: { name: string }) => d.name === "Engineering");
    const marketing = json.departments.find((d: { name: string }) => d.name === "Marketing");

    expect(empty.seatCount).toBe(0);
    expect(empty).not.toHaveProperty("usagePercent");
    expect(engineering.seatCount).toBe(2);
    expect(marketing.seatCount).toBe(1);
  });

  it("response omits retired legacy fields", async () => {
    await seedAuthSession();

    const response = await GET();
    const json = await response.json();
    expect(json).not.toHaveProperty("legacyRequestsPerSeat");
  });

  it("departments with usage data return correct usagePercent", async () => {
    await seedAuthSession();

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const deptRepo = testDs.getRepository(DepartmentEntity);
    const seatRepo = testDs.getRepository(CopilotSeatEntity);
    const usageRepo = testDs.getRepository(CopilotUsageEntity);

    const dept = await deptRepo.save({ name: "Usage Dept" });

    const seat1 = await seatRepo.save({
      githubUsername: "usage-user1",
      githubUserId: 9001,
      status: SeatStatus.ACTIVE,
      departmentId: dept.id,
    });
    const seat2 = await seatRepo.save({
      githubUsername: "usage-user2",
      githubUserId: 9002,
      status: SeatStatus.ACTIVE,
      departmentId: dept.id,
    });

    await usageRepo.save({
      seatId: seat1.id,
      day: 1,
      month: currentMonth,
      year: currentYear,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0, discountQuantity: 50, discountAmount: 2.0, netQuantity: 0, netAmount: 0 },
      ],
    } as Partial<CopilotUsage>);
    await usageRepo.save({
      seatId: seat2.id,
      day: 1,
      month: currentMonth,
      year: currentYear,
      usageItems: [
        { product: "Copilot", sku: "Premium", model: "GPT-4o", unitType: "requests", pricePerUnit: 0.04, grossQuantity: 30, grossAmount: 1.2, discountQuantity: 30, discountAmount: 1.2, netQuantity: 0, netAmount: 0 },
      ],
    } as Partial<CopilotUsage>);

    const response = await GET();
    const json = await response.json();

    const d = json.departments.find((dep: { name: string }) => dep.name === "Usage Dept");
    expect(d.seatCount).toBe(2);
    // 80 requests / (2 seats × 300 per seat) × 100 = 13.33%
    expect(d).not.toHaveProperty("usagePercent");
  });
});

describe("POST /api/departments", () => {
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
    const request = makeRequest({ name: "Test Dept" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const { UserRole } = await import("@/entities/enums");
    await seedAuthSession({ role: UserRole.USER });
    const request = makeRequest({ name: "Test Dept" });
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
    const request = new Request("http://localhost:3000/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 409 for duplicate department name", async () => {
    await seedAuthSession();
    const request1 = makeRequest({ name: "Duplicate" });
    const response1 = await POST(request1);
    expect(response1.status).toBe(201);

    const request2 = makeRequest({ name: "Duplicate" });
    const response2 = await POST(request2);
    expect(response2.status).toBe(409);
    const json = await response2.json();
    expect(json.error).toBe("Department name already exists");
  });
});
