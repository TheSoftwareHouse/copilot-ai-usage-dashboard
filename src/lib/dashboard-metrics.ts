import { getDb } from "@/lib/db";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { SEAT_BASE_COST_USD } from "@/lib/constants";
import { EntityManager } from "typeorm";
import {
  DashboardMonthlySummaryEntity,
  type ModelUsageEntry,
  type UserActivityEntry,
} from "@/entities/dashboard-monthly-summary.entity";
import { SeatStatus } from "@/entities/enums";

/**
 * Recalculate and upsert dashboard metrics for the given month/year.
 *
 * Aggregates data from `copilot_seat` and `copilot_usage` tables and writes
 * the result into `dashboard_monthly_summary`. Called after successful
 * seat-sync jobs.
 */
export async function refreshDashboardMetrics(
  month: number,
  year: number,
  entityManager?: EntityManager,
): Promise<void> {
  const dataSource = entityManager ? null : await getDb();
  const queryRunner = entityManager ?? dataSource;
  if (!queryRunner) {
    throw new Error("Dashboard metrics query runner is not available");
  }

  const seatRepository = queryRunner.getRepository(CopilotSeatEntity);
  const summaryRepository = queryRunner.getRepository(
    DashboardMonthlySummaryEntity,
  );

  // 1. Seat counts (current snapshot)
  const totalSeats = await seatRepository.count();
  const activeSeats = await seatRepository.count({
    where: { status: SeatStatus.ACTIVE },
  });

  // 2. Per-model usage: SUM(grossQuantity) and AIC spending grouped by model
  const modelUsageRows: { model: string; totalRequests: number; totalAmount: number }[] =
    await queryRunner.query(
      `SELECT
         item->>'model' AS "model",
         SUM((item->>'grossQuantity')::numeric) AS "totalRequests",
         SUM((item->>'grossAmount')::numeric) AS "totalAmount"
       FROM copilot_usage cu,
            jsonb_array_elements(cu."usageItems") AS item
       WHERE cu."month" = $1 AND cu."year" = $2
       GROUP BY item->>'model'
       ORDER BY "totalAmount" DESC`,
      [month, year],
    );

  const modelUsage: ModelUsageEntry[] = modelUsageRows.map((row) => ({
    model: row.model,
    totalRequests: Number(row.totalRequests),
    totalAmount: Number(row.totalAmount),
  }));

  // 3. Most active users: top 5 by SUM(grossQuantity)
  const mostActiveRows: {
    seatId: number;
    githubUsername: string;
    firstName: string | null;
    lastName: string | null;
    totalRequests: number;
    totalSpending: number;
  }[] = await queryRunner.query(
    `SELECT
       cs.id AS "seatId",
       cs."githubUsername",
       cs."firstName",
       cs."lastName",
       SUM((item->>'grossQuantity')::numeric) AS "totalRequests",
       SUM((item->>'grossAmount')::numeric) AS "totalSpending"
     FROM copilot_usage cu
     JOIN copilot_seat cs ON cs.id = cu."seatId"
     CROSS JOIN jsonb_array_elements(cu."usageItems") AS item
     WHERE cu."month" = $1 AND cu."year" = $2
     GROUP BY cs.id, cs."githubUsername", cs."firstName", cs."lastName"
     ORDER BY "totalRequests" DESC
     LIMIT 5`,
    [month, year],
  );

  const mostActiveUsers: UserActivityEntry[] = mostActiveRows.map((row) => ({
    seatId: Number(row.seatId),
    githubUsername: row.githubUsername,
    firstName: row.firstName,
    lastName: row.lastName,
    totalRequests: Number(row.totalRequests),
    totalSpending: Number(row.totalSpending),
  }));

  // 4. Least active users: bottom 5 by SUM(grossQuantity) (with any usage)
  const leastActiveRows: {
    seatId: number;
    githubUsername: string;
    firstName: string | null;
    lastName: string | null;
    totalRequests: number;
    totalSpending: number;
  }[] = await queryRunner.query(
    `SELECT
       cs.id AS "seatId",
       cs."githubUsername",
       cs."firstName",
       cs."lastName",
       SUM((item->>'grossQuantity')::numeric) AS "totalRequests",
       SUM((item->>'grossAmount')::numeric) AS "totalSpending"
     FROM copilot_usage cu
     JOIN copilot_seat cs ON cs.id = cu."seatId"
     CROSS JOIN jsonb_array_elements(cu."usageItems") AS item
     WHERE cu."month" = $1 AND cu."year" = $2
     GROUP BY cs.id, cs."githubUsername", cs."firstName", cs."lastName"
     ORDER BY "totalRequests" ASC
     LIMIT 5`,
    [month, year],
  );

  const leastActiveUsers: UserActivityEntry[] = leastActiveRows.map((row) => ({
    seatId: Number(row.seatId),
    githubUsername: row.githubUsername,
    firstName: row.firstName,
    lastName: row.lastName,
    totalRequests: Number(row.totalRequests),
    totalSpending: Number(row.totalSpending),
  }));

  // 5. Spending + AIC-credit metrics (single scan)
  const aggregateResult: {
    usageSpending: string | null;
    totalAiCredits: string | null;
  }[] = await queryRunner.query(
    `SELECT
       COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "usageSpending",
       COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalAiCredits"
     FROM copilot_usage cu,
          jsonb_array_elements(cu."usageItems") AS item
     WHERE cu."month" = $1 AND cu."year" = $2`,
    [month, year],
  );

  const usageSpending = Number(aggregateResult[0]?.usageSpending ?? 0);
  const totalAiCredits = Math.round(Number(aggregateResult[0]?.totalAiCredits ?? 0));

  // Seat base cost: per active seat per month
  const seatBaseCost = activeSeats * SEAT_BASE_COST_USD;

  // Total spending = usage cost + seat license cost
  const totalSpending = usageSpending + seatBaseCost;

  // 6. Upsert into dashboard_monthly_summary
  await summaryRepository
    .createQueryBuilder()
    .insert()
    .into(DashboardMonthlySummaryEntity)
    .values({
      month,
      year,
      totalSeats,
      activeSeats,
      totalSpending,
      seatBaseCost,
      totalAiCredits,
      modelUsage,
      mostActiveUsers,
      leastActiveUsers,
    })
    .orUpdate(
      [
        "totalSeats",
        "activeSeats",
        "totalSpending",
        "seatBaseCost",
        "totalAiCredits",
        "modelUsage",
        "mostActiveUsers",
        "leastActiveUsers",
        "updatedAt",
      ],
      ["month", "year"],
    )
    .execute();

  console.log(`Dashboard metrics refreshed for ${month}/${year}`);
}
