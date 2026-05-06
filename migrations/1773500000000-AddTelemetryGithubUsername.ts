import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelemetryGithubUsername1773500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "telemetry_event" ADD COLUMN "githubUsername" VARCHAR(255) DEFAULT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_telemetry_event_github_username" ON "telemetry_event" ("githubUsername")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_telemetry_event_timestamp_ym" ON "telemetry_event" (EXTRACT(YEAR FROM "timestamp" AT TIME ZONE 'UTC'), EXTRACT(MONTH FROM "timestamp" AT TIME ZONE 'UTC'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_telemetry_event_timestamp_ym"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_telemetry_event_github_username"`,
    );
    await queryRunner.query(
      `ALTER TABLE "telemetry_event" DROP COLUMN "githubUsername"`,
    );
  }
}
