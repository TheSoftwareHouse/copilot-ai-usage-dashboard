/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { ConfigurationEntity, type Configuration } from "@/entities/configuration.entity";
import { SeatStatus, ApiMode } from "@/entities/enums";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import {
  calculateDeviation,
  calculateSeatDeviation,
} from "@/lib/norm-calculation";

// ---------------------------------------------------------------------------
// Unit tests for pure functions (no DB required)
// ---------------------------------------------------------------------------

describe("calculateDeviation", () => {
  it("returns 'none' with multiplier 0 when normValue is null", () => {
    const result = calculateDeviation(100, null, 1.5, 2.0);
    expect(result).toEqual({ level: "none", multiplier: 0 });
  });

  it("returns 'none' with multiplier 0 when dayUsage is 0", () => {
    const result = calculateDeviation(0, 50, 1.5, 2.0);
    expect(result).toEqual({ level: "none", multiplier: 0 });
  });

  it("returns 'none' when dayUsage is below warning threshold", () => {
    // norm=100, warning=1.5 → threshold at 150. Usage=120 → below
    const result = calculateDeviation(120, 100, 1.5, 2.0);
    expect(result.level).toBe("none");
    expect(result.multiplier).toBeCloseTo(1.2);
  });

  it("returns 'warning' when dayUsage >= norm × warningThreshold and < norm × alertThreshold", () => {
    // norm=100, warning=1.5 → 150, alert=2.0 → 200. Usage=160 → warning
    const result = calculateDeviation(160, 100, 1.5, 2.0);
    expect(result.level).toBe("warning");
    expect(result.multiplier).toBeCloseTo(1.6);
  });

  it("returns 'alert' when dayUsage >= norm × alertThreshold", () => {
    // norm=100, alert=2.0 → 200. Usage=250 → alert
    const result = calculateDeviation(250, 100, 1.5, 2.0);
    expect(result.level).toBe("alert");
    expect(result.multiplier).toBeCloseTo(2.5);
  });

  it("computes correct multiplier (dayUsage / normValue)", () => {
    const result = calculateDeviation(75, 50, 1.5, 2.0);
    expect(result.multiplier).toBe(1.5);
  });

  it("returns 'warning' at exact boundary (usage === norm × warningThreshold)", () => {
    // norm=100, warning=1.5 → exactly 150
    const result = calculateDeviation(150, 100, 1.5, 2.0);
    expect(result.level).toBe("warning");
    expect(result.multiplier).toBe(1.5);
  });

  it("returns 'alert' at exact boundary (usage === norm × alertThreshold)", () => {
    // norm=100, alert=2.0 → exactly 200
    const result = calculateDeviation(200, 100, 1.5, 2.0);
    expect(result.level).toBe("alert");
    expect(result.multiplier).toBe(2.0);
  });
});

describe("calculateSeatDeviation", () => {
  it("returns 'none' with null peaks when peakDailyRequests is null", () => {
    const result = calculateSeatDeviation(null, 5, 100, 1.5, 2.0);
    expect(result).toEqual({
      deviationLevel: "none",
      peakMultiplier: null,
      peakDay: null,
    });
  });

  it("returns 'none' with null peaks when normValue is null", () => {
    const result = calculateSeatDeviation(200, 5, null, 1.5, 2.0);
    expect(result).toEqual({
      deviationLevel: "none",
      peakMultiplier: null,
      peakDay: null,
    });
  });

  it("returns correct level and peakMultiplier for alert-level peak", () => {
    // norm=100, alert=2.0 → threshold 200. peak=250 → alert
    const result = calculateSeatDeviation(250, 10, 100, 1.5, 2.0);
    expect(result.deviationLevel).toBe("alert");
    expect(result.peakMultiplier).toBeCloseTo(2.5);
    expect(result.peakDay).toBe(10);
  });

  it("returns correct level and peakMultiplier for warning-level peak", () => {
    // norm=100, warning=1.5 → 150, alert=2.0 → 200. peak=160 → warning
    const result = calculateSeatDeviation(160, 15, 100, 1.5, 2.0);
    expect(result.deviationLevel).toBe("warning");
    expect(result.peakMultiplier).toBeCloseTo(1.6);
    expect(result.peakDay).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Integration tests for calculateNorm (requires PostgreSQL test database)
// ---------------------------------------------------------------------------

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

const { calculateNorm } = await import("@/lib/norm-calculation");

async function seedConfiguration(
  overrides: Partial<Configuration> = {},
): Promise<Configuration> {
  const configRepo = testDs.getRepository(ConfigurationEntity);
  return configRepo.save({
    apiMode: ApiMode.ORGANISATION,
    entityName: "test-org",
    normSeatsCount: 30,
    deviationWarningThreshold: 1.5,
    deviationAlertThreshold: 2.0,
    ...overrides,
  } as Partial<Configuration>);
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

describe("calculateNorm (integration)", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
  });

  it("returns normValue null when no usage data exists for the previous month", async () => {
    await seedConfiguration({ normSeatsCount: 10 });

    // Requesting March 2026 → previous month is February 2026 → no data
    const result = await calculateNorm(3, 2026);
    expect(result.normValue).toBeNull();
    expect(result.warningThreshold).toBe(1.5);
    expect(result.alertThreshold).toBe(2.0);
  });

  it("returns normValue null when no configuration exists (graceful fallback)", async () => {
    // No configuration seeded — should use defaults and return null (no data)
    const result = await calculateNorm(3, 2026);
    expect(result.normValue).toBeNull();
    expect(result.warningThreshold).toBe(1.5);
    expect(result.alertThreshold).toBe(2.0);
  });

  it("calculates correct norm with 3 seats and normSeatsCount=2 (uses top 2)", async () => {
    await seedConfiguration({ normSeatsCount: 2 });

    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1 });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 2 });
    const seat3 = await seedSeat({ githubUsername: "user3", githubUserId: 3 });

    // Previous month of March 2026 = February 2026 (28 days)
    // seat1: day1=100, day2=50 → total 150
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(100)] });
    await seedUsage({ seatId: seat1.id, day: 2, month: 2, year: 2026, usageItems: [makeUsageItem(50)] });

    // seat2: day1=200 → total 200
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(200)] });

    // seat3: day1=30 → total 30 (lowest, should be excluded with normSeatsCount=2)
    await seedUsage({ seatId: seat3.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(30)] });

    const result = await calculateNorm(3, 2026);

    // Top 2 seats: seat2 (200) + seat1 (150) = 350
    // norm = 350 / 2 / 28 = 6.25
    expect(result.normValue).toBeCloseTo(6.25);
  });

  it("uses all available seats when fewer than N have usage", async () => {
    await seedConfiguration({ normSeatsCount: 10 });

    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1 });

    // Previous month of March 2026 = February 2026 (28 days)
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(280)] });

    const result = await calculateNorm(3, 2026);

    // Only 1 seat available, norm = 280 / 1 / 28 = 10
    expect(result.normValue).toBeCloseTo(10);
  });

  it("correctly rolls over January → December of previous year", async () => {
    await seedConfiguration({ normSeatsCount: 5 });

    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1 });

    // Previous month of January 2026 = December 2025 (31 days)
    await seedUsage({ seatId: seat1.id, day: 1, month: 12, year: 2025, usageItems: [makeUsageItem(310)] });

    const result = await calculateNorm(1, 2026);

    // norm = 310 / 1 / 31 = 10
    expect(result.normValue).toBeCloseTo(10);
  });

  it("norm recalculates with different normSeatsCount configuration value", async () => {
    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1 });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 2 });

    // Previous month of March 2026 = February 2026 (28 days)
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(280)] });
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(140)] });

    // With normSeatsCount=1: top 1 seat (seat1: 280), norm = 280 / 1 / 28 = 10
    await seedConfiguration({ normSeatsCount: 1 });
    const result1 = await calculateNorm(3, 2026);
    expect(result1.normValue).toBeCloseTo(10);

    // Update config to normSeatsCount=2
    const configRepo = testDs.getRepository(ConfigurationEntity);
    const existing = await configRepo.findOne({ where: {} });
    await configRepo.save({ ...existing, normSeatsCount: 2 });

    // With normSeatsCount=2: top 2 seats (280 + 140 = 420), norm = 420 / 2 / 28 = 7.5
    const result2 = await calculateNorm(3, 2026);
    expect(result2.normValue).toBeCloseTo(7.5);
  });

  it("excludes zero-usage seats from top N ranking", async () => {
    await seedConfiguration({ normSeatsCount: 5 });

    const seat1 = await seedSeat({ githubUsername: "user1", githubUserId: 1 });
    const seat2 = await seedSeat({ githubUsername: "user2", githubUserId: 2 });

    // Previous month of March 2026 = February 2026 (28 days)
    // seat1 has real usage
    await seedUsage({ seatId: seat1.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(140)] });

    // seat2 has zero usage — all grossQuantity = 0
    await seedUsage({ seatId: seat2.id, day: 1, month: 2, year: 2026, usageItems: [makeUsageItem(0)] });

    const result = await calculateNorm(3, 2026);

    // Only seat1 counted (HAVING > 0 excludes seat2), norm = 140 / 1 / 28 = 5
    expect(result.normValue).toBeCloseTo(5);
  });
});
