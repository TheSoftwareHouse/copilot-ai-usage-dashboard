/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { ConfigurationEntity, type Configuration } from "@/entities/configuration.entity";
import { ApiMode } from "@/entities/enums";
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
  it("returns 'none' when usage is 0", () => {
    expect(calculateDeviation(0, null, 500, 1000)).toEqual({ level: "none", multiplier: 0 });
  });

  it("returns 'none' when dayUsage is below warning threshold", () => {
    const result = calculateDeviation(120, 100, 150, 200);
    expect(result.level).toBe("none");
    expect(result.multiplier).toBe(120);
  });

  it("returns 'warning' when dayUsage reaches the warning threshold", () => {
    const result = calculateDeviation(160, 100, 150, 200);
    expect(result.level).toBe("warning");
    expect(result.multiplier).toBe(160);
  });

  it("returns 'alert' when dayUsage reaches the alert threshold", () => {
    const result = calculateDeviation(250, 100, 150, 200);
    expect(result.level).toBe("alert");
    expect(result.multiplier).toBe(250);
  });

  it("returns 'warning' at the exact warning threshold", () => {
    const result = calculateDeviation(150, 100, 150, 200);
    expect(result.level).toBe("warning");
    expect(result.multiplier).toBe(150);
  });

  it("returns 'alert' at the exact alert threshold", () => {
    const result = calculateDeviation(200, 100, 150, 200);
    expect(result.level).toBe("alert");
    expect(result.multiplier).toBe(200);
  });
});

describe("calculateSeatDeviation", () => {
  it("returns 'none' with null peaks when peakDailyRequests is null", () => {
    const result = calculateSeatDeviation(null, 5, 100, 150, 200);
    expect(result).toEqual({
      deviationLevel: "none",
      peakMultiplier: null,
      peakDay: null,
    });
  });

  it("returns correct level and peakMultiplier for alert-level peak", () => {
    const result = calculateSeatDeviation(250, 10, 100, 150, 200);
    expect(result.deviationLevel).toBe("alert");
    expect(result.peakMultiplier).toBe(250);
    expect(result.peakDay).toBe(10);
  });

  it("returns correct level and peakMultiplier for warning-level peak", () => {
    const result = calculateSeatDeviation(160, 15, 100, 150, 200);
    expect(result.deviationLevel).toBe("warning");
    expect(result.peakMultiplier).toBe(160);
    expect(result.peakDay).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Integration tests for threshold lookup (requires PostgreSQL test database)
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
    deviationWarningThreshold: 500,
    deviationAlertThreshold: 1000,
    ...overrides,
  } as Partial<Configuration>);
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

  it("returns static fallback thresholds when no configuration exists", async () => {
    const result = await calculateNorm(3, 2026);
    expect(result.normValue).toBeNull();
    expect(result.warningThreshold).toBe(500);
    expect(result.alertThreshold).toBe(1000);
  });

  it("returns configured static thresholds", async () => {
    await seedConfiguration({ deviationWarningThreshold: 750, deviationAlertThreshold: 1500 });
    const result = await calculateNorm(3, 2026);
    expect(result.normValue).toBeNull();
    expect(result.warningThreshold).toBe(750);
    expect(result.alertThreshold).toBe(1500);
  });
});
