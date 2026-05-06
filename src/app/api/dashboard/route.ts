import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { getPremiumAllowance } from "@/lib/get-premium-allowance";
import { handleRouteError } from "@/lib/api-helpers";
import { formatName } from "@/lib/format-helpers";

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

    const summary = await summaryRepo.findOne({ where: { month, year } });
    const premiumRequestsPerSeat = await getPremiumAllowance();

    // Fetch previous month's summary for trend indicator
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    if (summary) {
      const includedPremiumRequests = summary.activeSeats * premiumRequestsPerSeat;
      const includedPremiumRequestsUsed = summary.includedPremiumRequestsUsed;
      const includedPremiumRequestsRemaining = Math.max(0, includedPremiumRequests - includedPremiumRequestsUsed);
      const totalPremiumRequests = summary.totalPremiumRequests;
      const paidPremiumRequests = Math.max(0, totalPremiumRequests - includedPremiumRequestsUsed);

      const previousSummary = await summaryRepo.findOne({ where: { month: prevMonth, year: prevYear } });
      const previousIncludedPremiumRequests = previousSummary
        ? previousSummary.activeSeats * premiumRequestsPerSeat
        : null;
      const previousIncludedPremiumRequestsUsed = previousSummary
        ? previousSummary.includedPremiumRequestsUsed
        : null;

      const dailyRows: { day: number; totalRequests: string }[] =
        await dataSource.query(
          `SELECT
             cu."day",
             SUM((item->>'grossQuantity')::numeric) AS "totalRequests"
           FROM copilot_usage cu,
                jsonb_array_elements(cu."usageItems") AS item
           WHERE cu."month" = $1 AND cu."year" = $2
           GROUP BY cu."day"
           ORDER BY cu."day" ASC`,
          [month, year],
        );

      const dailyUsage = dailyRows.map((row) => ({
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

      const topDailySpendingRows: {
        seatId: number;
        githubUsername: string;
        firstName: string | null;
        lastName: string | null;
        day: number;
        totalSpending: string;
      }[] = await dataSource.query(
        `SELECT
           cs."id" AS "seatId",
           cs."githubUsername",
           cs."firstName",
           cs."lastName",
           cu."day",
           SUM((item->>'netAmount')::numeric) AS "totalSpending"
         FROM copilot_usage cu
           JOIN copilot_seat cs ON cu."seatId" = cs."id",
           jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."month" = $1 AND cu."year" = $2
         GROUP BY cs."id", cs."githubUsername", cs."firstName", cs."lastName", cu."day"
         ORDER BY "totalSpending" DESC
         LIMIT 10`,
        [month, year],
      );

      const topDailySpendings = topDailySpendingRows.map((row) => ({
        seatId: row.seatId,
        githubUsername: row.githubUsername,
        displayName: formatName(row.firstName, row.lastName, row.githubUsername),
        day: row.day,
        totalSpending: Number(row.totalSpending),
      }));

      return NextResponse.json({
        totalSeats: summary.totalSeats,
        activeSeats: summary.activeSeats,
        modelUsage: summary.modelUsage,
        mostActiveUsers: summary.mostActiveUsers,
        leastActiveUsers: summary.leastActiveUsers,
        totalSpending: Number(summary.totalSpending),
        seatBaseCost: Number(summary.seatBaseCost),
        includedPremiumRequests,
        includedPremiumRequestsUsed,
        includedPremiumRequestsRemaining,
        totalPremiumRequests,
        paidPremiumRequests,
        premiumRequestsPerSeat,
        previousIncludedPremiumRequests,
        previousIncludedPremiumRequestsUsed,
        dailyUsage,
        previousDailyUsage,
        topDailySpendings,
        month,
        year,
      });
    }

    // Empty state — no data for the requested month/year
    return NextResponse.json({
      totalSeats: 0,
      activeSeats: 0,
      modelUsage: [],
      mostActiveUsers: [],
      leastActiveUsers: [],
      totalSpending: 0,
      seatBaseCost: 0,
      includedPremiumRequests: 0,
      includedPremiumRequestsUsed: 0,
      includedPremiumRequestsRemaining: 0,
      totalPremiumRequests: 0,
      paidPremiumRequests: 0,
      premiumRequestsPerSeat,
      previousIncludedPremiumRequests: null,
      previousIncludedPremiumRequestsUsed: null,
      dailyUsage: [],
      previousDailyUsage: [],
      topDailySpendings: [],
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/dashboard");
  }
}
