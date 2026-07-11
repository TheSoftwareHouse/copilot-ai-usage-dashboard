import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandDeviationThresholdPrecision1773700000000 implements MigrationInterface {
    name = 'ExpandDeviationThresholdPrecision1773700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationWarningThreshold" TYPE NUMERIC(6,2)`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationAlertThreshold" TYPE NUMERIC(6,2)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationAlertThreshold" TYPE NUMERIC(5,2)`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationWarningThreshold" TYPE NUMERIC(5,2)`);
    }
}