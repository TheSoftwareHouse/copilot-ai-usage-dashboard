import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTelemetryEvent1773400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "telemetry_event" (
        "id" SERIAL PRIMARY KEY,
        "batchId" UUID NOT NULL,
        "schemaVersion" VARCHAR(10) NOT NULL,
        "timestamp" TIMESTAMPTZ NOT NULL,
        "hookTimestamp" TIMESTAMPTZ NOT NULL,
        "sessionId" VARCHAR(36) NOT NULL,
        "eventType" VARCHAR(20) NOT NULL,
        "workspaceName" VARCHAR(255) NOT NULL,
        "data" JSONB NOT NULL,
        "eventHash" VARCHAR(64) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_telemetry_event_hash" ON "telemetry_event" ("eventHash")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_telemetry_event_session_id" ON "telemetry_event" ("sessionId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_telemetry_event_batch_id" ON "telemetry_event" ("batchId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_telemetry_event_type_created" ON "telemetry_event" ("eventType", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_telemetry_event_type_created"`);
    await queryRunner.query(`DROP INDEX "IDX_telemetry_event_batch_id"`);
    await queryRunner.query(`DROP INDEX "IDX_telemetry_event_session_id"`);
    await queryRunner.query(`DROP INDEX "UQ_telemetry_event_hash"`);
    await queryRunner.query(`DROP TABLE "telemetry_event"`);
  }
}
