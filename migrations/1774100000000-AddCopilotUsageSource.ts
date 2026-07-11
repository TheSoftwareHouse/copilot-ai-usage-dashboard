import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCopilotUsageSource1774100000000 implements MigrationInterface {
    name = 'AddCopilotUsageSource1774100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."copilot_usage_source_enum" AS ENUM('csv_import', 'github_api')`);
        await queryRunner.query(`ALTER TABLE "copilot_usage" ADD "source" "public"."copilot_usage_source_enum" NOT NULL DEFAULT 'csv_import'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "copilot_usage" DROP COLUMN "source"`);
        await queryRunner.query(`DROP TYPE "public"."copilot_usage_source_enum"`);
    }

}