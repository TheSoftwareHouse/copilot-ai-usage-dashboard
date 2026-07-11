/// <reference types="vitest/globals" />
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DataSource } from "typeorm";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type UsageItem } from "@/entities/copilot-usage.entity";
import { CopilotUsageSource } from "@/entities/enums";
import { ImportHistoryEntity } from "@/entities/import-history.entity";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

vi.mock("@/lib/dashboard-metrics", () => ({
  refreshDashboardMetrics: vi.fn(),
}));

const { importAicCsvUsage } = await import("@/lib/aic-csv-import");
const { refreshDashboardMetrics } = await import("@/lib/dashboard-metrics");
const mockedRefreshDashboardMetrics = vi.mocked(refreshDashboardMetrics);

async function seedSeat(ds: DataSource, username: string): Promise<number> {
  const seatRepository = ds.getRepository(CopilotSeatEntity);
  const seat = await seatRepository.save({
    githubUsername: username,
    githubUserId: Math.floor(Math.random() * 100000),
  });

  return seat.id;
}

async function seedUsage(
  ds: DataSource,
  seatId: number,
  day: number,
  month: number,
  year: number,
  usageItems: UsageItem[],
  source: CopilotUsageSource = CopilotUsageSource.CSV_IMPORT,
): Promise<void> {
  const usageRepository = ds.getRepository(CopilotUsageEntity);
  await usageRepository.save({
    seatId,
    day,
    month,
    year,
    source,
    usageItems,
  });
}

function makeUsageItem(
  model: string,
  grossQuantity: number,
  grossAmount: number,
): UsageItem {
  return {
    product: "Copilot",
    sku: "AIC",
    model,
    unitType: "requests",
    pricePerUnit: grossQuantity > 0 ? grossAmount / grossQuantity : 0,
    grossQuantity,
    grossAmount,
    discountQuantity: 0,
    discountAmount: 0,
    netQuantity: 0,
    netAmount: 0,
  };
}

function buildCsv(rows: string[]): string {
  return [
    "date,username,model,product,sku,aic_quantity,aic_gross_amount",
    ...rows,
  ].join("\n");
}

describe("importAicCsvUsage", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
    await cleanDatabase(testDs);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aggregates rows per seat/day, overwrites existing usage rows, and records import history", async () => {
    const octocatSeatId = await seedSeat(testDs, "octocat");
    const hubotSeatId = await seedSeat(testDs, "hubot");

    await seedUsage(testDs, octocatSeatId, 2, 5, 2026, [
      makeUsageItem("Claude Sonnet 4.5", 3, 1.5),
    ]);

    const csv = buildCsv([
      "2026-05-02,  OctoCat  ,Claude Sonnet 4.5,Copilot,AIC,10,5.50",
      "2026-05-02,octocat,Claude Sonnet 4.5,Copilot,AIC,2,1.25",
      "2026-05-02,octocat,GPT-4o,Copilot,AIC,3,0.75",
      "2026-05-03,hubot,GPT-4o,Copilot,AIC,4,2.00",
      "2026-05-03,missing-user,GPT-4o,Copilot,AIC,7,9.00",
    ]);

    const result = await importAicCsvUsage({
      filename: "billing.csv",
      csvContent: csv,
    });

    expect(result.recordsProcessed).toBe(5);
    expect(result.matchedUserCount).toBe(2);
    expect(result.skippedUserCount).toBe(1);
    expect(result.skippedUsernames).toEqual(["missing-user"]);
    expect(result.affectedMonths).toEqual([{ month: 5, year: 2026 }]);
    expect(result.overwrittenSeatDayCount).toBe(1);
    expect(result.overwriteWarnings).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.importHistoryId).toBeGreaterThan(0);

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    const octocatUsage = await usageRepository.findOne({
      where: {
        seatId: octocatSeatId,
        day: 2,
        month: 5,
        year: 2026,
      },
    });

    expect(octocatUsage).not.toBeNull();
    expect(octocatUsage!.source).toBe(CopilotUsageSource.CSV_IMPORT);
    expect(octocatUsage!.usageItems).toHaveLength(2);

    const claudeUsage = octocatUsage!.usageItems.find(
      (usageItem) => usageItem.model === "Claude Sonnet 4.5",
    );
    const gptUsage = octocatUsage!.usageItems.find(
      (usageItem) => usageItem.model === "GPT-4o",
    );

    expect(claudeUsage).toEqual({
      product: "Copilot",
      sku: "AIC",
      model: "Claude Sonnet 4.5",
      unitType: "requests",
      pricePerUnit: 0.5625,
      grossQuantity: 12,
      grossAmount: 6.75,
      discountQuantity: 0,
      discountAmount: 0,
      netQuantity: 0,
      netAmount: 0,
    });
    expect(gptUsage).toEqual({
      product: "Copilot",
      sku: "AIC",
      model: "GPT-4o",
      unitType: "requests",
      pricePerUnit: 0.25,
      grossQuantity: 3,
      grossAmount: 0.75,
      discountQuantity: 0,
      discountAmount: 0,
      netQuantity: 0,
      netAmount: 0,
    });

    const hubotUsage = await usageRepository.findOne({
      where: {
        seatId: hubotSeatId,
        day: 3,
        month: 5,
        year: 2026,
      },
    });

    expect(hubotUsage).not.toBeNull();
    expect(hubotUsage!.source).toBe(CopilotUsageSource.CSV_IMPORT);
    expect(hubotUsage!.usageItems).toEqual([
      {
        product: "Copilot",
        sku: "AIC",
        model: "GPT-4o",
        unitType: "requests",
        pricePerUnit: 0.5,
        grossQuantity: 4,
        grossAmount: 2,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      },
    ]);

    const historyRepository = testDs.getRepository(ImportHistoryEntity);
    const historyRows = await historyRepository.find({
      order: { executedAt: "DESC" },
    });

    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].filename).toBe("billing.csv");
    expect(historyRows[0].recordsProcessed).toBe(5);
    expect(historyRows[0].matchedUserCount).toBe(2);
    expect(historyRows[0].skippedUserCount).toBe(1);
    expect(historyRows[0].skippedUsernames).toEqual(["missing-user"]);
    expect(historyRows[0].affectedMonths).toEqual([{ month: 5, year: 2026 }]);
    expect(historyRows[0].overwrittenSeatDayCount).toBe(1);
  });

  it("keeps GitHub API rows intact and reports protected overwrite attempts", async () => {
    const octocatSeatId = await seedSeat(testDs, "octocat");

    await seedUsage(
      testDs,
      octocatSeatId,
      2,
      5,
      2026,
      [makeUsageItem("Claude Sonnet 4.5", 3, 1.5)],
      CopilotUsageSource.GITHUB_API,
    );

    const csv = buildCsv(["2026-05-02,octocat,GPT-4o,Copilot,AIC,5,2.50"]);

    const result = await importAicCsvUsage({
      filename: "blocked-by-api.csv",
      csvContent: csv,
    });

    expect(result.recordsProcessed).toBe(1);
    expect(result.matchedUserCount).toBe(1);
    expect(result.skippedUserCount).toBe(0);
    expect(result.overwrittenSeatDayCount).toBe(0);
    expect(result.overwriteWarnings).toEqual([
      "Skipped 1 seat/day row(s) because GitHub API data already exists.",
    ]);
    expect(result.affectedMonths).toEqual([]);

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    const usage = await usageRepository.findOne({
      where: {
        seatId: octocatSeatId,
        day: 2,
        month: 5,
        year: 2026,
      },
    });

    expect(usage).not.toBeNull();
    expect(usage!.source).toBe(CopilotUsageSource.GITHUB_API);
    expect(usage!.usageItems).toEqual([
      {
        product: "Copilot",
        sku: "AIC",
        model: "Claude Sonnet 4.5",
        unitType: "requests",
        pricePerUnit: 0.5,
        grossQuantity: 3,
        grossAmount: 1.5,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      },
    ]);

    expect(await testDs.getRepository(ImportHistoryEntity).count()).toBe(1);
  });

  it("accepts BOM-prefixed GitHub exports with fully quoted columns", async () => {
    await seedSeat(testDs, "octocat");

    const csv = [
      '"date","username","product","sku","model","quantity","unit_type","applied_cost_per_quantity","gross_amount","discount_amount","net_amount","exceeds_quota","total_monthly_quota","organization","cost_center_name","aic_quantity","aic_gross_amount"',
      '"2026-05-02","octocat","copilot","copilot_premium_request","Claude Opus 4.6","3","requests","0.04","0.12","0.12","0","False","300","TheSoftwareHouse","","31.7579","0.317579"',
    ].join("\n");

    const result = await importAicCsvUsage({
      filename: "quoted-bom.csv",
      csvContent: `\uFEFF${csv}`,
    });

    expect(result.recordsProcessed).toBe(1);
    expect(result.matchedUserCount).toBe(1);
    expect(result.skippedUserCount).toBe(0);

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    const usage = await usageRepository.findOne({
      where: {
        day: 2,
        month: 5,
        year: 2026,
      },
    });

    expect(usage).not.toBeNull();
    expect(usage!.usageItems).toEqual([
      {
        product: "copilot",
        sku: "copilot_premium_request",
        model: "Claude Opus 4.6",
        unitType: "requests",
        pricePerUnit: 0.01,
        grossQuantity: 31.7579,
        grossAmount: 0.317579,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      },
    ]);
  });

  it("skips rows with blank usernames instead of failing the import", async () => {
    await seedSeat(testDs, "octocat");

    const result = await importAicCsvUsage({
      filename: "blank-username.csv",
      csvContent: buildCsv([
        "2026-05-02,,GPT-4o,Copilot,AIC,3,1.50",
        "2026-05-02,octocat,GPT-4o,Copilot,AIC,4,2.00",
      ]),
    });

    expect(result.recordsProcessed).toBe(1);
    expect(result.matchedUserCount).toBe(1);
    expect(result.skippedUserCount).toBe(0);
    expect(result.skippedUsernames).toEqual([]);

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    const usage = await usageRepository.findOne({
      where: {
        day: 2,
        month: 5,
        year: 2026,
      },
    });

    expect(usage).not.toBeNull();
    expect(usage!.usageItems).toEqual([
      {
        product: "Copilot",
        sku: "AIC",
        model: "GPT-4o",
        unitType: "requests",
        pricePerUnit: 0.5,
        grossQuantity: 4,
        grossAmount: 2,
        discountQuantity: 0,
        discountAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      },
    ]);
  });

  it("returns refresh warnings when a post-commit dashboard rebuild fails", async () => {
    const octocatSeatId = await seedSeat(testDs, "octocat");

    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const csv = buildCsv([
      "2026-05-02,octocat,GPT-4o,Copilot,AIC,1,0.50",
      "2026-06-03,octocat,GPT-4o,Copilot,AIC,2,1.00",
    ]);

    mockedRefreshDashboardMetrics.mockImplementation(async (month, year) => {
      if (month === 5 && year === 2026) {
        throw new Error("Simulated summary refresh failure");
      }
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await importAicCsvUsage({
      filename: "refresh-warning.csv",
      csvContent: csv,
    });

    expect(result.recordsProcessed).toBe(2);
    expect(result.affectedMonths).toEqual([
      { month: 5, year: 2026 },
      { month: 6, year: 2026 },
    ]);
    expect(result.warnings).toEqual([
      "Dashboard summary refresh failed for 5/2026: Simulated summary refresh failure",
    ]);
    expect(mockedRefreshDashboardMetrics).toHaveBeenCalledTimes(2);
    expect(mockedRefreshDashboardMetrics).toHaveBeenNthCalledWith(1, 5, 2026);
    expect(mockedRefreshDashboardMetrics).toHaveBeenNthCalledWith(2, 6, 2026);
    expect(warnSpy).toHaveBeenCalledWith(
      "Dashboard summary refresh failed for 5/2026: Simulated summary refresh failure",
    );

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    expect(
      await usageRepository.findOne({
        where: {
          seatId: octocatSeatId,
          day: 2,
          month: 5,
          year: 2026,
        },
      }),
    ).not.toBeNull();
    expect(
      await usageRepository.findOne({
        where: {
          seatId: octocatSeatId,
          day: 3,
          month: 6,
          year: 2026,
        },
      }),
    ).not.toBeNull();

    const historyRepository = testDs.getRepository(ImportHistoryEntity);
    expect(await historyRepository.count()).toBe(1);

    warnSpy.mockRestore();
  });

  it.each([
    ["   "],
    ["date,username,model,product,sku,aic_quantity,aic_gross_amount"],
  ])("rejects empty CSV inputs", async (csvContent) => {
    await expect(
      importAicCsvUsage({
        filename: "empty.csv",
        csvContent,
      }),
    ).rejects.toMatchObject({
      message: "CSV file is empty or has no data rows.",
      code: "EMPTY_FILE",
    });

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    expect(await usageRepository.count()).toBe(0);
    const historyRepository = testDs.getRepository(ImportHistoryEntity);
    expect(await historyRepository.count()).toBe(0);
  });

  it("rejects files that are missing required columns", async () => {
    await expect(
      importAicCsvUsage({
        filename: "missing-columns.csv",
        csvContent:
          "date,username,model,product,sku,aic_quantity\n2026-05-02,octocat,GPT-4o,Copilot,AIC,1",
      }),
    ).rejects.toMatchObject({
      message: "CSV is missing required columns: aic_gross_amount.",
      code: "MISSING_COLUMNS",
    });
  });

  it("rejects rows with invalid numbers", async () => {
    await expect(
      importAicCsvUsage({
        filename: "invalid-number.csv",
        csvContent: buildCsv([
          "2026-05-02,octocat,GPT-4o,Copilot,AIC,not-a-number,1.25",
        ]),
      }),
    ).rejects.toMatchObject({
      message: "CSV row 2: aic_quantity is not parseable.",
      code: "PARSE_ERROR",
    });
  });

  it.each([
    ["2026-04-30"],
    ["2026-06-01"],
  ])("rejects rows outside the allowed date window", async (dateValue) => {
    await expect(
      importAicCsvUsage({
        filename: "date-range.csv",
        csvContent: buildCsv([
          `${dateValue},octocat,GPT-4o,Copilot,AIC,1,0.50`,
        ]),
      }),
    ).rejects.toMatchObject({
      code: "DATE_RANGE",
    });
  });

  it("rolls back usage writes when the transactional history insert fails", async () => {
    const seatId = await seedSeat(testDs, "octocat");

    const csv = buildCsv([
      "2026-05-02,octocat,GPT-4o,Copilot,AIC,1,0.50",
    ]);

    const realQueryRunner = testDs.createQueryRunner();
    let saveCalls = 0;

    const queryRunnerManager = Object.create(realQueryRunner.manager) as typeof realQueryRunner.manager;
    queryRunnerManager.save = (async (...args: unknown[]) => {
      saveCalls += 1;

      if (saveCalls === 2) {
        throw new Error("Simulated import history failure");
      }

      return Reflect.apply(realQueryRunner.manager.save, realQueryRunner.manager, args);
    }) as typeof queryRunnerManager.save;

    const mockedQueryRunner = {
      ...realQueryRunner,
      manager: queryRunnerManager,
      connect: realQueryRunner.connect.bind(realQueryRunner),
      startTransaction: realQueryRunner.startTransaction.bind(realQueryRunner),
      commitTransaction: realQueryRunner.commitTransaction.bind(realQueryRunner),
      rollbackTransaction: realQueryRunner.rollbackTransaction.bind(realQueryRunner),
      release: realQueryRunner.release.bind(realQueryRunner),
    };

    const createQueryRunnerSpy = vi
      .spyOn(testDs, "createQueryRunner")
      .mockReturnValue(mockedQueryRunner as never);

    await expect(
      importAicCsvUsage({
        filename: "rollback.csv",
        csvContent: csv,
      }),
    ).rejects.toThrow("Simulated import history failure");

    createQueryRunnerSpy.mockRestore();

    const usageRepository = testDs.getRepository(CopilotUsageEntity);
    expect(
      await usageRepository.findOne({
        where: {
          seatId,
          day: 2,
          month: 5,
          year: 2026,
        },
      }),
    ).toBeNull();

    const historyRepository = testDs.getRepository(ImportHistoryEntity);
    expect(await historyRepository.count()).toBe(0);
  });
});
