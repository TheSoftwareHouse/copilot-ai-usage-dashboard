import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNormConfiguration1773600000000 implements MigrationInterface {
    name = 'AddNormConfiguration1773600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" ADD "normSeatsCount" integer NOT NULL DEFAULT 30`);
        await queryRunner.query(`ALTER TABLE "configuration" ADD "deviationWarningThreshold" NUMERIC(5,2) NOT NULL DEFAULT 1.50`);
        await queryRunner.query(`ALTER TABLE "configuration" ADD "deviationAlertThreshold" NUMERIC(5,2) NOT NULL DEFAULT 2.00`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "configuration" DROP COLUMN "deviationAlertThreshold"`);
        await queryRunner.query(`ALTER TABLE "configuration" DROP COLUMN "deviationWarningThreshold"`);
        await queryRunner.query(`ALTER TABLE "configuration" DROP COLUMN "normSeatsCount"`);
    }

}
