/// <reference types="vitest/globals" />
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { ImportHistoryEntity } from "@/entities/import-history.entity";

let testDs: DataSource;

beforeAll(async () => {
  testDs = await getTestDataSource();
});

afterAll(async () => {
  await destroyTestDataSource();
});

beforeEach(async () => {
  await cleanDatabase(testDs);
});

describe("ImportHistory persistence", () => {
  it("creates rows and returns them newest-first", async () => {
    const repo = testDs.getRepository(ImportHistoryEntity);

    await repo.save([
      {
        filename: "older.csv",
        executedAt: new Date("2026-05-20T10:00:00Z"),
        recordsProcessed: 12,
        matchedUserCount: 10,
        skippedUserCount: 2,
        skippedUsernames: ["missing-user"],
        affectedMonths: [{ month: 5, year: 2026 }],
        overwrittenSeatDayCount: 1,
      },
      {
        filename: "newer.csv",
        executedAt: new Date("2026-05-21T10:00:00Z"),
        recordsProcessed: 8,
        matchedUserCount: 8,
        skippedUserCount: 0,
        skippedUsernames: [],
        affectedMonths: [
          { month: 5, year: 2026 },
          { month: 6, year: 2026 },
        ],
        overwrittenSeatDayCount: 3,
      },
    ]);

    const rows = await repo.find({ order: { executedAt: "DESC" } });

    expect(rows).toHaveLength(2);
    expect(rows[0].filename).toBe("newer.csv");
    expect(rows[0].recordsProcessed).toBe(8);
    expect(rows[0].matchedUserCount).toBe(8);
    expect(rows[0].skippedUserCount).toBe(0);
    expect(rows[0].skippedUsernames).toEqual([]);
    expect(rows[0].affectedMonths).toEqual([
      { month: 5, year: 2026 },
      { month: 6, year: 2026 },
    ]);
    expect(rows[0].overwrittenSeatDayCount).toBe(3);

    const found = await repo.findOneBy({ filename: "older.csv" });
    expect(found).not.toBeNull();
    expect(found!.skippedUsernames).toEqual(["missing-user"]);
    expect(found!.affectedMonths).toEqual([{ month: 5, year: 2026 }]);
  });
});