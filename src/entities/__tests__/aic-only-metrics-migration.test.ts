/// <reference types="vitest/globals" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { getTestDataSource, destroyTestDataSource } from "@/test/db-helpers";
import { RenameAiCreditsAndArchivePremiumAllowance1774300000000 } from "../../../migrations/1774300000000-RenameAiCreditsAndArchivePremiumAllowance";

let testDs: DataSource;
const migration = new RenameAiCreditsAndArchivePremiumAllowance1774300000000();
const TEST_SCHEMA = "test_aic_only_metrics_migration";

beforeAll(async () => {
  testDs = await getTestDataSource();
});

afterAll(async () => {
  await destroyTestDataSource();
});

beforeEach(async () => {
  await testDs.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
  await testDs.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}"."dashboard_monthly_summary"`);
  await testDs.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}"."configuration"`);
});

async function createLegacySchemaInRunnerSchema(queryRunner: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE "dashboard_monthly_summary" (
      "id" SERIAL PRIMARY KEY,
      "month" SMALLINT NOT NULL,
      "year" SMALLINT NOT NULL,
      "totalPremiumRequests" INTEGER NOT NULL DEFAULT 0,
      "includedPremiumRequestsUsed" INTEGER NOT NULL DEFAULT 0
    )
  `);

  await queryRunner.query(`
    CREATE TABLE "configuration" (
      "id" SERIAL PRIMARY KEY,
      "singletonKey" VARCHAR(10) NOT NULL DEFAULT 'GLOBAL',
      "premiumRequestsPerSeat" INTEGER NOT NULL DEFAULT 300
    )
  `);

  await queryRunner.query(`
    INSERT INTO "dashboard_monthly_summary" (
      "month",
      "year",
      "totalPremiumRequests",
      "includedPremiumRequestsUsed"
    ) VALUES
      (5, 2024, 1200, 300),
      (6, 2024, 450, 50)
  `);

  await queryRunner.query(`
    INSERT INTO "configuration" ("singletonKey", "premiumRequestsPerSeat")
    VALUES ('GLOBAL', 450)
  `);
}

describe("AIC-only metrics migration", () => {
  it("renames summary and configuration columns without losing values", async () => {
    const runMigrationsPath = path.resolve(process.cwd(), "scripts/run-migrations.ts");
    const runMigrationsSource = readFileSync(runMigrationsPath, "utf8");
    expect(runMigrationsSource).toContain(
      'import { RenameAiCreditsAndArchivePremiumAllowance1774300000000 } from "../migrations/1774300000000-RenameAiCreditsAndArchivePremiumAllowance";'
    );
    expect(runMigrationsSource).toContain(
      "RenameAiCreditsAndArchivePremiumAllowance1774300000000,"
    );

    const queryRunner = testDs.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`SET search_path TO "${TEST_SCHEMA}", public`);
      await createLegacySchemaInRunnerSchema(queryRunner);

      const summaryRowsBefore = (await queryRunner.query(
        'SELECT "month", "year", "totalPremiumRequests", "includedPremiumRequestsUsed" FROM "dashboard_monthly_summary" ORDER BY "month"'
      )) as Array<{ month: number; year: number; totalPremiumRequests: number; includedPremiumRequestsUsed: number }>;
      const configurationRowsBefore = (await queryRunner.query(
        'SELECT "singletonKey", "premiumRequestsPerSeat" FROM "configuration"'
      )) as Array<{ singletonKey: string; premiumRequestsPerSeat: number }>;

      expect(summaryRowsBefore).toHaveLength(2);
      expect(summaryRowsBefore[0].totalPremiumRequests).toBe(1200);
      expect(summaryRowsBefore[1].totalPremiumRequests).toBe(450);
      expect(configurationRowsBefore[0].premiumRequestsPerSeat).toBe(450);

      await migration.up(queryRunner);
      const summaryColumns = (await queryRunner.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = '${TEST_SCHEMA}'
           AND table_name = 'dashboard_monthly_summary'
           AND column_name IN ('totalAiCredits', 'includedPremiumRequestsUsed', 'totalPremiumRequests')
         ORDER BY column_name`
      )) as Array<{ column_name: string }>;
      const summaryRowsAfter = (await queryRunner.query(
        'SELECT "month", "year", "totalAiCredits", "includedPremiumRequestsUsed" FROM "dashboard_monthly_summary" ORDER BY "month"'
      )) as Array<{ month: number; year: number; totalAiCredits: number; includedPremiumRequestsUsed: number }>;

      expect(summaryColumns.map((column) => column.column_name)).toEqual([
        "includedPremiumRequestsUsed",
        "totalAiCredits",
      ]);
      expect(summaryRowsAfter).toHaveLength(2);
      expect(summaryRowsAfter[0].totalAiCredits).toBe(1200);
      expect(summaryRowsAfter[1].totalAiCredits).toBe(450);
      expect(summaryRowsAfter[0].includedPremiumRequestsUsed).toBe(300);
      expect(summaryRowsAfter[1].includedPremiumRequestsUsed).toBe(50);

      const configurationColumns = (await queryRunner.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = '${TEST_SCHEMA}'
           AND table_name = 'configuration'
           AND column_name IN ('premiumRequestsPerSeatArchived', 'premiumRequestsPerSeat')
         ORDER BY column_name`
      )) as Array<{ column_name: string }>;
      const configurationRowsAfter = (await queryRunner.query(
        'SELECT "singletonKey", "premiumRequestsPerSeatArchived" FROM "configuration"'
      )) as Array<{ singletonKey: string; premiumRequestsPerSeatArchived: number }>;

      expect(configurationColumns.map((column) => column.column_name)).toEqual([
        "premiumRequestsPerSeatArchived",
      ]);
      expect(configurationRowsAfter[0].premiumRequestsPerSeatArchived).toBe(450);

      await migration.down(queryRunner);

      const summaryColumnsAfterRollback = (await queryRunner.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = '${TEST_SCHEMA}'
           AND table_name = 'dashboard_monthly_summary'
           AND column_name IN ('totalAiCredits', 'includedPremiumRequestsUsed', 'totalPremiumRequests')
         ORDER BY column_name`
      )) as Array<{ column_name: string }>;
      const summaryRowsAfterRollback = (await queryRunner.query(
        'SELECT "month", "year", "totalPremiumRequests", "includedPremiumRequestsUsed" FROM "dashboard_monthly_summary" ORDER BY "month"'
      )) as Array<{ month: number; year: number; totalPremiumRequests: number; includedPremiumRequestsUsed: number }>;

      expect(summaryColumnsAfterRollback.map((column) => column.column_name)).toEqual([
        "includedPremiumRequestsUsed",
        "totalPremiumRequests",
      ]);
      expect(summaryRowsAfterRollback[0].totalPremiumRequests).toBe(1200);
      expect(summaryRowsAfterRollback[1].totalPremiumRequests).toBe(450);
      expect(summaryRowsAfterRollback[0].includedPremiumRequestsUsed).toBe(300);
      expect(summaryRowsAfterRollback[1].includedPremiumRequestsUsed).toBe(50);

      const configurationColumnsAfterRollback = (await queryRunner.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = '${TEST_SCHEMA}'
           AND table_name = 'configuration'
           AND column_name IN ('premiumRequestsPerSeatArchived', 'premiumRequestsPerSeat')
         ORDER BY column_name`
      )) as Array<{ column_name: string }>;
      const configurationRowsAfterRollback = (await queryRunner.query(
        'SELECT "singletonKey", "premiumRequestsPerSeat" FROM "configuration"'
      )) as Array<{ singletonKey: string; premiumRequestsPerSeat: number }>;

      expect(configurationColumnsAfterRollback.map((column) => column.column_name)).toEqual([
        "premiumRequestsPerSeat",
      ]);
      expect(configurationRowsAfterRollback[0].premiumRequestsPerSeat).toBe(450);
    } finally {
      await queryRunner.query("SET search_path TO public");
      await queryRunner.release();
      await testDs.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
    }
  });
});
