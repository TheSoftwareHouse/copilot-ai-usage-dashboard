import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { getDashboardMetricMode, isAicReportingMonth } from "@/lib/aic-reporting";
import { refreshDashboardMetrics } from "@/lib/dashboard-metrics";
import { calculateUsageCostMetrics } from "@/lib/usage-cost-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  try {
    const { searchParams } = request.nextUrl;

    const now = new Date();
    const defaultMonth = now.getUTCMonth() + 1;
    const defaultYear = now.getUTCFullYear();

    let month = parseInt(searchParams.get("month") ?? "", 10);
    if (isNaN(month) || month < 1 || month > 12) month = defaultMonth;

    let year = parseInt(searchParams.get("year") ?? "", 10);
    if (isNaN(year) || year < 2020) year = defaultYear;

    const dataSource = await getDb();
    const summaryRepo = dataSource.getRepository(
      DashboardMonthlySummaryEntity,
    );
    const metricMode = getDashboardMetricMode();

    const monthlyUsageRows: { day: number; totalRequests: string; totalGrossQuantity: string }[] =
      await dataSource.query(
        `SELECT
           cu."day",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalGrossQuantity"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."month" = $1 AND cu."year" = $2
         GROUP BY cu."day"
         ORDER BY cu."day" ASC`,
        [month, year],
      );

    const dailyGrossQuantity = monthlyUsageRows.map((row) => ({
      day: row.day,
      grossQuantity: Number(row.totalGrossQuantity),
    }));

    const costStats = calculateUsageCostMetrics({
      month,
      year,
      dailyGrossQuantity,
    });

    let summary = await summaryRepo.findOne({ where: { month, year } });
    let summaryState: "summary" | "rebuilt" | "pending" | "empty" =
      summary ? "summary" : "empty";
    const summaryWarnings: string[] = [];

    if (!summary && metricMode === "aic" && isAicReportingMonth(month, year)) {
      const rawUsageExistsRow: { hasRawUsage: boolean }[] = await dataSource.query(
        `SELECT EXISTS(
           SELECT 1
           FROM copilot_usage cu
           WHERE cu."month" = $1 AND cu."year" = $2
         ) AS "hasRawUsage"`,
        [month, year],
      );

      const hasRawUsage = Boolean(rawUsageExistsRow[0]?.hasRawUsage);

      if (hasRawUsage) {
        try {
          await refreshDashboardMetrics(month, year);
          summary = await summaryRepo.findOne({ where: { month, year } });

          if (summary) {
            summaryState = "rebuilt";
          } else {
            summaryState = "pending";
            summaryWarnings.push(
              `Dashboard summary rebuild for ${month}/${year} completed without materializing a summary row.`,
            );
          }
        } catch (error) {
          summaryState = "pending";
          summaryWarnings.push(
            `Dashboard summary rebuild failed for ${month}/${year}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    // Fetch previous month's summary for trend indicator
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    if (summary) {
      const dailyUsage = monthlyUsageRows.map((row) => ({
        day: row.day,
        totalRequests: Number(row.totalRequests),
      }));

      const previousDailyRows: { day: number; totalRequests: string }[] =
        await dataSource.query(
          `SELECT
             cu."day",
             SUM((item->>'grossQuantity')::numeric) AS "totalRequests"
           FROM copilot_usage cu,
                jsonb_array_elements(cu."usageItems") AS item
           WHERE cu."month" = $1 AND cu."year" = $2
           GROUP BY cu."day"
           ORDER BY cu."day" ASC`,
          [prevMonth, prevYear],
        );

      const previousDailyUsage = previousDailyRows.map((row) => ({
        day: row.day,
        totalRequests: Number(row.totalRequests),
      }));

      return NextResponse.json({
        metricMode,
        summaryState,
        summaryWarnings,
        totalSeats: summary.totalSeats,
        activeSeats: summary.activeSeats,
        modelUsage: summary.modelUsage,
        mostActiveUsers: summary.mostActiveUsers,
        leastActiveUsers: summary.leastActiveUsers,
        totalSpending: Number(summary.totalSpending),
        seatBaseCost: Number(summary.seatBaseCost),
        totalAiCredits: summary.totalAiCredits,
        dailyUsage,
        dailyGrossUsage: dailyGrossQuantity,
        costStats,
        previousDailyUsage,
        month,
        year,
      });
    }

    // Empty state — no data for the requested month/year
    return NextResponse.json({
      metricMode,
      summaryState,
      summaryWarnings,
      totalSeats: 0,
      activeSeats: 0,
      modelUsage: [],
      mostActiveUsers: [],
      leastActiveUsers: [],
      totalSpending: 0,
      seatBaseCost: 0,
      totalAiCredits: 0,
      dailyUsage: [],
      dailyGrossUsage: dailyGrossQuantity,
      costStats,
      previousDailyUsage: [],
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/dashboard");
  }
}
