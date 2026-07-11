import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTeamMemberAllocationPercentage1774000000000
  implements MigrationInterface
{
  name = "AddTeamMemberAllocationPercentage1774000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_member_snapshot" ADD "allocationPercentage" smallint`,
    );
    await queryRunner.query(
      `UPDATE "team_member_snapshot" SET "allocationPercentage" = 100 WHERE "allocationPercentage" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_member_snapshot" ALTER COLUMN "allocationPercentage" SET DEFAULT 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_member_snapshot" ALTER COLUMN "allocationPercentage" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_member_snapshot" ADD CONSTRAINT "CHK_team_member_snapshot_allocation_percentage" CHECK ("allocationPercentage" >= 1 AND "allocationPercentage" <= 100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_member_snapshot" DROP CONSTRAINT "CHK_team_member_snapshot_allocation_percentage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_member_snapshot" DROP COLUMN "allocationPercentage"`,
    );
  }
}