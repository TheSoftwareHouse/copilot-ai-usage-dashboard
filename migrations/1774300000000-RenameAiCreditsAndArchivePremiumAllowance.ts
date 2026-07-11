import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameAiCreditsAndArchivePremiumAllowance1774300000000 implements MigrationInterface {
  name = "RenameAiCreditsAndArchivePremiumAllowance1774300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dashboard_monthly_summary" RENAME COLUMN "totalPremiumRequests" TO "totalAiCredits"`
    );
    await queryRunner.query(
      `ALTER TABLE "configuration" RENAME COLUMN "premiumRequestsPerSeat" TO "premiumRequestsPerSeatArchived"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "configuration" RENAME COLUMN "premiumRequestsPerSeatArchived" TO "premiumRequestsPerSeat"`
    );
    await queryRunner.query(
      `ALTER TABLE "dashboard_monthly_summary" RENAME COLUMN "totalAiCredits" TO "totalPremiumRequests"`
    );
  }
}
