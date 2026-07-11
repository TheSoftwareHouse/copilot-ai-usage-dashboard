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

const { GET } = await import(
  "@/app/api/usage/seats/[seatId]/models/[modelName]/route"
);
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

function makeGetRequest(
  seatId: string,
  modelName: string,
  params?: Record<string, string>,
): NextRequest {
  const url = new URL(
    `http://localhost:3000/api/usage/seats/${seatId}/models/${encodeURIComponent(modelName)}`,
  );
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

function makeContext(seatId: string, modelName: string) {
  return { params: Promise.resolve({ seatId, modelName: encodeURIComponent(modelName) }) };
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

describe("GET /api/usage/seats/[seatId]/models/[modelName]", () => {
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
    const request = makeGetRequest("1", "GPT-4o");
    const response = await GET(request as never, makeContext("1", "GPT-4o") as never);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid seat ID", async () => {
    await seedAuthSession();

    const request = makeGetRequest("abc", "GPT-4o");
    const response = await GET(request as never, makeContext("abc", "GPT-4o") as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid seat ID");
  });

  it("returns 400 for invalid model name", async () => {
    await seedAuthSession();

    const request = makeGetRequest("1", " ");
    const response = await GET(request as never, makeContext("1", " ") as never);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Validation failed");
    expect(json.details).toHaveProperty("modelName");
  });

  it("returns 400 for malformed model name encoding in route params", async () => {
    await seedAuthSession();

    const request = makeGetRequest("1", "Valid Model");
    const response = await GET(
      request as never,
      { params: Promise.resolve({ seatId: "1", modelName: "%E0%A4%A" }) } as never,
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Validation failed");
    expect(json.details).toHaveProperty("modelName");
  });

  it("returns 400 for invalid month and year", async () => {
    await seedAuthSession();

    const invalidMonthRequest = makeGetRequest("1", "GPT-4o", {
      month: "13",
      year: "2026",
    });
    const invalidMonthResponse = await GET(
      invalidMonthRequest as never,
      makeContext("1", "GPT-4o") as never,
    );
    expect(invalidMonthResponse.status).toBe(400);

    const invalidYearRequest = makeGetRequest("1", "GPT-4o", {
      month: "1",
      year: "2019",
    });
    const invalidYearResponse = await GET(
      invalidYearRequest as never,
      makeContext("1", "GPT-4o") as never,
    );
    expect(invalidYearResponse.status).toBe(400);
  });

  it("returns 404 for unknown seat", async () => {
    await seedAuthSession();

    const request = makeGetRequest("99999", "GPT-4o", {
      month: "2",
      year: "2026",
    });
    const response = await GET(
      request as never,
      makeContext("99999", "GPT-4o") as never,
    );
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("Seat not found");
  });

  it("returns grouped exact-model daily usage ordered by day with numeric totals", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "seat-user",
      githubUserId: 9001,
      firstName: "Seat",
      lastName: "User",
    });

    await seedUsage({
      seatId: seat.id,
      day: 3,
      month: 2,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: "GPT-4o",
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 5,
          grossAmount: 0.2,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 5,
          netAmount: 0.2,
        },
      ],
    });

    await seedUsage({
      seatId: seat.id,
      day: 1,
      month: 2,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: "GPT-4o",
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 10,
          grossAmount: 0.4,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 10,
          netAmount: 0.4,
        },
        {
          product: "Copilot",
          sku: "Premium",
          model: "GPT-4o",
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 2,
          grossAmount: 0.08,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 2,
          netAmount: 0.08,
        },
        {
          product: "Copilot",
          sku: "Premium",
          model: "Claude Sonnet 4.5",
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 999,
          grossAmount: 39.96,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 999,
          netAmount: 39.96,
        },
      ],
    });

    const request = makeGetRequest(String(seat.id), "GPT-4o", {
      month: "2",
      year: "2026",
    });
    const response = await GET(
      request as never,
      makeContext(String(seat.id), "GPT-4o") as never,
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.seat).toEqual({
      seatId: seat.id,
      githubUsername: "seat-user",
      firstName: "Seat",
      lastName: "User",
    });
    expect(json.model).toBe("GPT-4o");
    expect(json.month).toBe(2);
    expect(json.year).toBe(2026);

    expect(json.dailyUsage).toEqual([
      { day: 1, totalRequests: 12 },
      { day: 3, totalRequests: 5 },
    ]);
    expect(typeof json.dailyUsage[0].totalRequests).toBe("number");
  });

  it("returns empty dailyUsage array for model with no matching usage", async () => {
    await seedAuthSession();

    const seat = await seedSeat({
      githubUsername: "empty-model-user",
      githubUserId: 9002,
      firstName: "Empty",
      lastName: "Model",
    });

    await seedUsage({
      seatId: seat.id,
      day: 2,
      month: 3,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: "Claude Sonnet 4.5",
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 10,
          grossAmount: 0.4,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 10,
          netAmount: 0.4,
        },
      ],
    });

    const request = makeGetRequest(String(seat.id), "GPT-4o", {
      month: "3",
      year: "2026",
    });
    const response = await GET(
      request as never,
      makeContext(String(seat.id), "GPT-4o") as never,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.dailyUsage).toEqual([]);
  });

  it("supports model names with reserved URL characters", async () => {
    await seedAuthSession();

    const modelName = "gpt-4o/mini?beta#v1";
    const seat = await seedSeat({
      githubUsername: "reserved-char-user",
      githubUserId: 9003,
    });

    await seedUsage({
      seatId: seat.id,
      day: 4,
      month: 6,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: modelName,
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 7,
          grossAmount: 0.28,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 7,
          netAmount: 0.28,
        },
      ],
    });

    const request = makeGetRequest(String(seat.id), modelName, {
      month: "6",
      year: "2026",
    });
    const response = await GET(
      request as never,
      makeContext(String(seat.id), modelName) as never,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.model).toBe(modelName);
    expect(json.dailyUsage).toEqual([{ day: 4, totalRequests: 7 }]);
  });

  it("supports model names containing literal percent characters", async () => {
    await seedAuthSession();

    const modelName = "Model 100%";
    const seat = await seedSeat({
      githubUsername: "percent-model-user",
      githubUserId: 9004,
      firstName: "Percent",
      lastName: "Model",
    });

    await seedUsage({
      seatId: seat.id,
      day: 10,
      month: 6,
      year: 2026,
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: modelName,
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 11,
          grossAmount: 0.44,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 11,
          netAmount: 0.44,
        },
        {
          product: "Copilot",
          sku: "Premium",
          model: "Model 100",
          unitType: "requests",
          pricePerUnit: 0.04,
          grossQuantity: 99,
          grossAmount: 3.96,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 99,
          netAmount: 3.96,
        },
      ],
    });

    const request = makeGetRequest(String(seat.id), modelName, {
      month: "6",
      year: "2026",
    });
    const response = await GET(
      request as never,
      makeContext(String(seat.id), modelName) as never,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.model).toBe(modelName);
    expect(json.dailyUsage).toEqual([{ day: 10, totalRequests: 11 }]);
  });
});
