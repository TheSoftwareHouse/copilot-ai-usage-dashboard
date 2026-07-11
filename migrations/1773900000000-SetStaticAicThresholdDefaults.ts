import { MigrationInterface, QueryRunner } from "typeorm";

export class SetStaticAicThresholdDefaults1773900000000 implements MigrationInterface {
    name = 'SetStaticAicThresholdDefaults1773900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationWarningThreshold" SET DEFAULT 500.00`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationAlertThreshold" SET DEFAULT 1000.00`);
        await queryRunner.query(`UPDATE "configuration" SET "deviationWarningThreshold" = 500.00 WHERE "deviationWarningThreshold" = 1.50`);
        await queryRunner.query(`UPDATE "configuration" SET "deviationAlertThreshold" = 1000.00 WHERE "deviationAlertThreshold" = 2.00`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "configuration" SET "deviationAlertThreshold" = 2.00 WHERE "deviationAlertThreshold" = 1000.00`);
        await queryRunner.query(`UPDATE "configuration" SET "deviationWarningThreshold" = 1.50 WHERE "deviationWarningThreshold" = 500.00`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationAlertThreshold" SET DEFAULT 2.00`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationWarningThreshold" SET DEFAULT 1.50`);
    }
}