import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUsageCollectionJobExecutionStates1774200000000 implements MigrationInterface {
    name = 'AddUsageCollectionJobExecutionStates1774200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."job_execution_status_enum" ADD VALUE IF NOT EXISTS 'partial_failure'`);
        await queryRunner.query(`ALTER TYPE "public"."job_execution_status_enum" ADD VALUE IF NOT EXISTS 'blocked'`);
        await queryRunner.query(`ALTER TYPE "public"."job_execution_status_enum" ADD VALUE IF NOT EXISTS 'no_op'`);
        await queryRunner.query(`ALTER TABLE "job_execution" ADD COLUMN IF NOT EXISTS "reason" character varying(64)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_execution" DROP COLUMN IF EXISTS "reason"`);
        console.warn(
            'Cannot remove enum values "partial_failure", "blocked", or "no_op" from job_execution_status_enum. ' +
            'PostgreSQL does not support DROP VALUE from enums. Manual intervention required if rollback is needed.'
        );
    }
}