import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandDeviationThresholdPrecisionTo500001773800000000 implements MigrationInterface {
    name = 'ExpandDeviationThresholdPrecisionTo500001773800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationWarningThreshold" TYPE NUMERIC(7,2)`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationAlertThreshold" TYPE NUMERIC(7,2)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationAlertThreshold" TYPE NUMERIC(6,2)`);
        await queryRunner.query(`ALTER TABLE "configuration" ALTER COLUMN "deviationWarningThreshold" TYPE NUMERIC(6,2)`);
    }
}