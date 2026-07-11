/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { SeatStatus } from "@/entities/enums";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type CopilotUsage } from "@/entities/copilot-usage.entity";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

const { refreshDashboardMetrics } = await import("@/lib/dashboard-metrics");

async function seedSeat(
  ds: DataSource,
  username: string,
  status: SeatStatus = SeatStatus.ACTIVE,
  overrides: Partial<CopilotSeat> = {},
): Promise<number> {
  const repo = ds.getRepository(CopilotSeatEntity);
  const seat = await repo.save({
    githubUsername: username,
    githubUserId: Math.floor(Math.random() * 100000),
    status,
    ...overrides,
  });
  return seat.id;
}

async function seedUsage(
  ds: DataSource,
  seatId: number,
  day: number,
  month: number,
  year: number,
  usageItems: CopilotUsage["usageItems"],
): Promise<void> {
  const repo = ds.getRepository(CopilotUsageEntity);
  await repo.save({
    seatId,
    day,
    month,
    year,
    usageItems,
  } as Partial<CopilotUsage>);
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

describe("refreshDashboardMetrics", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
  });

  it("correctly counts total seats and active seats", async () => {
    await seedSeat(testDs, "active-user-1", SeatStatus.ACTIVE);
    await seedSeat(testDs, "active-user-2", SeatStatus.ACTIVE);
    await seedSeat(testDs, "inactive-user-1", SeatStatus.INACTIVE);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary).not.toBeNull();
    expect(summary!.totalSeats).toBe(3);
    expect(summary!.activeSeats).toBe(2);
    expect(Number(summary!.seatBaseCost)).toBe(38); // 2 active × $19
  });

  it("correctly aggregates per-model usage from JSONB usageItems", async () => {
    const seatId = await seedSeat(testDs, "user-1");

    await seedUsage(testDs, seatId, 1, 2, 2026, [
      makeUsageItem("Claude Sonnet 4.5", 10, 5.0),
      makeUsageItem("GPT-4o", 20, 3.0),
    ]);
    await seedUsage(testDs, seatId, 2, 2, 2026, [
      makeUsageItem("Claude Sonnet 4.5", 5, 2.5),
      makeUsageItem("GPT-4o", 10, 1.5),
    ]);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary).not.toBeNull();
    expect(summary!.modelUsage).toHaveLength(2);

    // Sorted by totalAmount descending
    const claude = summary!.modelUsage.find((m) => m.model === "Claude Sonnet 4.5");
    const gpt = summary!.modelUsage.find((m) => m.model === "GPT-4o");

    expect(claude).toBeDefined();
    expect(claude!.totalRequests).toBe(15);
    expect(claude!.totalAmount).toBe(7.5);

    expect(gpt).toBeDefined();
    expect(gpt!.totalRequests).toBe(30);
    expect(gpt!.totalAmount).toBe(4.5);
  });

  it("correctly identifies top 5 most active users by request count", async () => {
    // Seed 7 users with varying request quantities
    const users = [
      { name: "heavy-1", quantity: 500 },
      { name: "heavy-2", quantity: 400 },
      { name: "heavy-3", quantity: 300 },
      { name: "heavy-4", quantity: 200 },
      { name: "heavy-5", quantity: 100 },
      { name: "light-1", quantity: 50 },
      { name: "light-2", quantity: 25 },
    ];

    for (const u of users) {
      const seatId = await seedSeat(testDs, u.name);
      await seedUsage(testDs, seatId, 1, 2, 2026, [
        makeUsageItem("GPT-4o", u.quantity, u.quantity * 0.5),
      ]);
    }

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary!.mostActiveUsers).toHaveLength(5);
    expect(summary!.mostActiveUsers[0].githubUsername).toBe("heavy-1");
    expect(summary!.mostActiveUsers[0].totalRequests).toBe(500);
    expect(summary!.mostActiveUsers[0].totalSpending).toBe(250); // 500 * 0.5
    expect(typeof summary!.mostActiveUsers[0].seatId).toBe("number");
    expect(summary!.mostActiveUsers[4].githubUsername).toBe("heavy-5");
    expect(summary!.mostActiveUsers[4].totalRequests).toBe(100);
    expect(summary!.mostActiveUsers[4].totalSpending).toBe(50); // 100 * 0.5

    // light-1 and light-2 should NOT be in most active
    const usernames = summary!.mostActiveUsers.map((u) => u.githubUsername);
    expect(usernames).not.toContain("light-1");
    expect(usernames).not.toContain("light-2");
  });

  it("correctly identifies bottom 5 least active users by request count", async () => {
    const users = [
      { name: "heavy-1", quantity: 500 },
      { name: "heavy-2", quantity: 400 },
      { name: "heavy-3", quantity: 300 },
      { name: "light-1", quantity: 25 },
      { name: "light-2", quantity: 50 },
      { name: "light-3", quantity: 75 },
      { name: "light-4", quantity: 100 },
      { name: "light-5", quantity: 125 },
    ];

    for (const u of users) {
      const seatId = await seedSeat(testDs, u.name);
      await seedUsage(testDs, seatId, 1, 2, 2026, [
        makeUsageItem("GPT-4o", u.quantity, u.quantity * 0.5),
      ]);
    }

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary!.leastActiveUsers).toHaveLength(5);
    // Ascending order by request count
    expect(summary!.leastActiveUsers[0].githubUsername).toBe("light-1");
    expect(summary!.leastActiveUsers[0].totalRequests).toBe(25);
    expect(summary!.leastActiveUsers[0].totalSpending).toBe(12.5); // 25 * 0.5
    expect(typeof summary!.leastActiveUsers[0].seatId).toBe("number");
    expect(summary!.leastActiveUsers[4].githubUsername).toBe("light-5");
    expect(summary!.leastActiveUsers[4].totalRequests).toBe(125);
    expect(summary!.leastActiveUsers[4].totalSpending).toBe(62.5); // 125 * 0.5

    // heavy users should NOT be in least active
    const usernames = summary!.leastActiveUsers.map((u) => u.githubUsername);
    expect(usernames).not.toContain("heavy-1");
    expect(usernames).not.toContain("heavy-2");
    expect(usernames).not.toContain("heavy-3");
  });

  it("correctly calculates total spending as grossAmount + seatBaseCost", async () => {
    const seat1 = await seedSeat(testDs, "user-1");
    const seat2 = await seedSeat(testDs, "user-2");

    await seedUsage(testDs, seat1, 1, 2, 2026, [
      makeUsageItem("Claude Sonnet 4.5", 10, 5.0, 2, 1.0),
      makeUsageItem("GPT-4o", 20, 3.0, 1, 0.5),
    ]);
    await seedUsage(testDs, seat2, 1, 2, 2026, [
      makeUsageItem("Claude Sonnet 4.5", 5, 2.0, 1, 0.5),
    ]);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    // grossAmount total = 5 + 3 + 2 = 10, seatBaseCost = 2 active × $19 = 38
    // totalSpending = 10 + 38 = 48
    expect(Number(summary!.seatBaseCost)).toBe(38);
    expect(Number(summary!.totalSpending)).toBe(48);
  });

  it("uses grossAmount for AIC months starting in May 2026", async () => {
    const seatId = await seedSeat(testDs, "aic-user");

    await seedUsage(testDs, seatId, 2, 5, 2026, [
      {
        product: "Copilot",
        sku: "AIC",
        model: "GPT-4o",
        unitType: "requests",
        pricePerUnit: 0.5,
        grossQuantity: 10,
        grossAmount: 5,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      },
    ]);

    await refreshDashboardMetrics(5, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 5, year: 2026 } });

    expect(summary).not.toBeNull();
    expect(summary!.modelUsage[0].totalAmount).toBe(5);
    expect(summary!.mostActiveUsers[0].totalSpending).toBe(5);
    expect(Number(summary!.totalSpending)).toBe(24);
    expect(summary!.totalAiCredits).toBe(10);
  });

  it("upsert updates existing row rather than creating duplicate", async () => {
    const seatId = await seedSeat(testDs, "user-1");

    // First refresh with some usage (1 active seat → seatBaseCost=19)
    await seedUsage(testDs, seatId, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 10, 5.0),
    ]);
    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    let all = await repo.find({ where: { month: 2, year: 2026 } });
    expect(all).toHaveLength(1);
    // totalSpending = netAmount(5) + seatBaseCost(19) = 24
    expect(Number(all[0].totalSpending)).toBe(24);

    // Add more usage and refresh again
    await seedUsage(testDs, seatId, 2, 2, 2026, [
      makeUsageItem("GPT-4o", 20, 10.0),
    ]);
    await refreshDashboardMetrics(2, 2026);

    all = await repo.find({ where: { month: 2, year: 2026 } });
    expect(all).toHaveLength(1);
    // totalSpending = netAmount(5+10=15) + seatBaseCost(19) = 34
    expect(Number(all[0].totalSpending)).toBe(34);
  });

  it("stores empty arrays and seatBaseCost spending when no usage data exists", async () => {
    await seedSeat(testDs, "user-1");

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary).not.toBeNull();
    expect(summary!.totalSeats).toBe(1);
    expect(summary!.activeSeats).toBe(1);
    // No usage, but 1 active seat → seatBaseCost=19, totalSpending=19
    expect(Number(summary!.seatBaseCost)).toBe(19);
    expect(Number(summary!.totalSpending)).toBe(19);
    expect(summary!.totalAiCredits).toBe(0);
    expect(summary!.modelUsage).toEqual([]);
    expect(summary!.mostActiveUsers).toEqual([]);
    expect(summary!.leastActiveUsers).toEqual([]);
  });

  it("different months produce separate summary rows", async () => {
    const seatId = await seedSeat(testDs, "user-1");

    await seedUsage(testDs, seatId, 1, 1, 2026, [
      makeUsageItem("GPT-4o", 10, 5.0),
    ]);
    await seedUsage(testDs, seatId, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 20, 15.0),
    ]);

    await refreshDashboardMetrics(1, 2026);
    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const jan = await repo.findOne({ where: { month: 1, year: 2026 } });
    const feb = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(jan).not.toBeNull();
    expect(feb).not.toBeNull();
    // 1 active seat → seatBaseCost=19 each month
    expect(Number(jan!.totalSpending)).toBe(24);  // net 5 + 19
    expect(Number(feb!.totalSpending)).toBe(34);  // net 15 + 19
  });

  it("includes firstName and lastName in user activity entries", async () => {
    const seatId = await seedSeat(testDs, "john-doe", SeatStatus.ACTIVE, {
      firstName: "John",
      lastName: "Doe",
    });

    await seedUsage(testDs, seatId, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 10, 5.0),
    ]);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary!.mostActiveUsers[0].githubUsername).toBe("john-doe");
    expect(summary!.mostActiveUsers[0].firstName).toBe("John");
    expect(summary!.mostActiveUsers[0].lastName).toBe("Doe");
    expect(summary!.mostActiveUsers[0].totalRequests).toBe(10);
    expect(summary!.mostActiveUsers[0].totalSpending).toBe(5.0);
  });

  it("correctly computes total AIC credits as uncapped sum", async () => {
    const seat1 = await seedSeat(testDs, "user-1");
    const seat2 = await seedSeat(testDs, "user-2");

    // user-1: day 1 = 200 requests, day 2 = 200 requests => 400 total
    await seedUsage(testDs, seat1, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 200, 10.0),
    ]);
    await seedUsage(testDs, seat1, 2, 2, 2026, [
      makeUsageItem("GPT-4o", 200, 10.0),
    ]);
    // user-2: day 1 = 100 requests
    await seedUsage(testDs, seat2, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 100, 5.0),
    ]);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    // Total uncapped: 400 + 100 = 500
    expect(summary!.totalAiCredits).toBe(500);
  });

  it("uses grossQuantity for AIC credits even when discountQuantity is present", async () => {
    const seat1 = await seedSeat(testDs, "user-1");
    const seat2 = await seedSeat(testDs, "user-2");

    // user-1: day1 discount=50, day2 discount=30
    await seedUsage(testDs, seat1, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 200, 10.0, 50, 2.5),
    ]);
    await seedUsage(testDs, seat1, 2, 2, 2026, [
      makeUsageItem("GPT-4o", 200, 10.0, 30, 1.5),
    ]);
    // user-2: discount=20
    await seedUsage(testDs, seat2, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 100, 5.0, 20, 1.0),
    ]);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary!.totalAiCredits).toBe(500);
    expect(Number(summary!.totalSpending)).toBe(63);
  });

  it("handles discountQuantity equal to grossQuantity without changing AIC totals", async () => {
    const seatId = await seedSeat(testDs, "user-1");

    // All 300 requests are discounted
    await seedUsage(testDs, seatId, 1, 2, 2026, [
      makeUsageItem("GPT-4o", 300, 15.0, 300, 15.0),
    ]);

    await refreshDashboardMetrics(2, 2026);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);
    const summary = await repo.findOne({ where: { month: 2, year: 2026 } });

    expect(summary!.totalAiCredits).toBe(300);
    // grossAmount = 15, seatBaseCost = 19, totalSpending = 34
    expect(Number(summary!.totalSpending)).toBe(34);
  });

  it("produces equivalent summary with injected EntityManager", async () => {
    const seat1 = await seedSeat(testDs, "manager-user-1");
    const seat2 = await seedSeat(testDs, "manager-user-2");

    await seedUsage(testDs, seat1, 5, 6, 2026, [
      makeUsageItem("GPT-4o", 24, 8.4),
      makeUsageItem("Claude Sonnet 4.5", 12, 6.3),
    ]);
    await seedUsage(testDs, seat2, 7, 6, 2026, [
      makeUsageItem("GPT-4o", 30, 10.5),
    ]);

    const repo = testDs.getRepository(DashboardMonthlySummaryEntity);

    await refreshDashboardMetrics(6, 2026);
    const defaultSummary = await repo.findOne({ where: { month: 6, year: 2026 } });
    expect(defaultSummary).not.toBeNull();

    await repo.delete({ month: 6, year: 2026 });

    await testDs.transaction(async (manager) => {
      await refreshDashboardMetrics(6, 2026, manager);
    });

    const managerSummary = await repo.findOne({ where: { month: 6, year: 2026 } });
    expect(managerSummary).not.toBeNull();

    expect(managerSummary).toMatchObject({
      month: defaultSummary!.month,
      year: defaultSummary!.year,
      totalSeats: defaultSummary!.totalSeats,
      activeSeats: defaultSummary!.activeSeats,
      totalAiCredits: defaultSummary!.totalAiCredits,
      modelUsage: defaultSummary!.modelUsage,
      mostActiveUsers: defaultSummary!.mostActiveUsers,
      leastActiveUsers: defaultSummary!.leastActiveUsers,
    });
    expect(Number(managerSummary!.totalSpending)).toBe(Number(defaultSummary!.totalSpending));
    expect(Number(managerSummary!.seatBaseCost)).toBe(Number(defaultSummary!.seatBaseCost));
  });
});
