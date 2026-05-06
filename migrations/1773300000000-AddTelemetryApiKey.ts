import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelemetryApiKey1773300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "configuration" ADD COLUMN "telemetryApiKey" VARCHAR(255) DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "configuration" DROP COLUMN "telemetryApiKey"`,
    );
  }
}
