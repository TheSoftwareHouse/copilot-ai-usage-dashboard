import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateImportHistory1773650000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_history" (
        "id" SERIAL PRIMARY KEY,
        "filename" VARCHAR(255) NOT NULL,
        "executedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
        "matchedUserCount" INTEGER NOT NULL DEFAULT 0,
        "skippedUserCount" INTEGER NOT NULL DEFAULT 0,
        "skippedUsernames" JSONB NOT NULL DEFAULT '[]',
        "affectedMonths" JSONB NOT NULL DEFAULT '[]',
        "overwrittenSeatDayCount" INTEGER NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_import_history_executed_at" ON "import_history" ("executedAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_import_history_executed_at"`);
    await queryRunner.query(`DROP TABLE "import_history"`);
  }
}