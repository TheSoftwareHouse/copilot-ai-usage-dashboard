import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { refreshDashboardMetrics } from "@/lib/dashboard-metrics";
import { handleRouteError } from "@/lib/api-helpers";
import { isAicReportingMonth } from "@/lib/aic-reporting";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  try {
    const { searchParams } = request.nextUrl;
    const monthParam = searchParams.get("month");
    const yearParam = searchParams.get("year");

    const dataSource = await getDb();

    let monthsToRecalculate: { month: number; year: number }[] = [];
    let skippedHistoricalMonths: { month: number; year: number }[] = [];

    if (monthParam !== null || yearParam !== null) {
      // Both params are required when filtering
      if (monthParam === null || yearParam === null) {
        return NextResponse.json(
          { error: "Both month and year parameters are required when filtering." },
          { status: 400 },
        );
      }

      const month = parseInt(monthParam, 10);
      const year = parseInt(yearParam, 10);

      if (isNaN(month) || month < 1 || month > 12) {
        return NextResponse.json(
          { error: "Invalid month parameter. Must be between 1 and 12." },
          { status: 400 },
        );
      }

      if (isNaN(year) || year < 2020) {
        return NextResponse.json(
          { error: "Invalid year parameter. Must be 2020 or later." },
          { status: 400 },
        );
      }

      if (!isAicReportingMonth(month, year)) {
        return NextResponse.json(
          {
            error:
              "Selected historical period is read-only under the AIC Credits reporting policy",
          },
          { status: 409 },
        );
      }

      monthsToRecalculate = [{ month, year }];
    } else {
      // All months: find distinct (month, year) from copilot_usage UNION dashboard_monthly_summary
      const rows: { month: number; year: number }[] = await dataSource.query(
        `SELECT DISTINCT "month", "year" FROM copilot_usage
         UNION
         SELECT DISTINCT "month", "year" FROM dashboard_monthly_summary
         ORDER BY "year" ASC, "month" ASC`,
      );

      const allMonths = rows.map((r) => ({
        month: Number(r.month),
        year: Number(r.year),
      }));

      monthsToRecalculate = allMonths.filter(({ month, year }) =>
        isAicReportingMonth(month, year),
      );
      skippedHistoricalMonths = allMonths.filter(({ month, year }) =>
        !isAicReportingMonth(month, year),
      );
    }

    const recalculatedMonths: { month: number; year: number }[] = [];

    for (const { month, year } of monthsToRecalculate) {
      await refreshDashboardMetrics(month, year);
      recalculatedMonths.push({ month, year });
    }

    return NextResponse.json({
      recalculatedMonths,
      skippedHistoricalMonths,
      total: recalculatedMonths.length,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/dashboard/recalculate");
  }
}
