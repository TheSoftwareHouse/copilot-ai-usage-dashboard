import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import {
  AIC_REPORTING_CUTOVER_MONTH,
  AIC_REPORTING_CUTOVER_YEAR,
  isAicReportingMonth,
} from "@/lib/aic-reporting";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  try {
    const dataSource = await getDb();
    const summaryRepo = dataSource.getRepository(
      DashboardMonthlySummaryEntity,
    );

    const summaryRows = await summaryRepo.find({
      select: ["month", "year"],
      order: { year: "DESC", month: "DESC" },
    });

    const rawUsageRows: { month: number; year: number }[] = await dataSource.query(
      `SELECT DISTINCT cu."month", cu."year"
       FROM copilot_usage cu
       WHERE cu."year" > $1 OR (cu."year" = $1 AND cu."month" >= $2)
       ORDER BY cu."year" DESC, cu."month" DESC`,
      [AIC_REPORTING_CUTOVER_YEAR, AIC_REPORTING_CUTOVER_MONTH],
    );

    const monthMap = new Map<string, { month: number; year: number }>();

    for (const row of summaryRows) {
      monthMap.set(`${row.year}-${row.month}`, {
        month: row.month,
        year: row.year,
      });
    }

    for (const row of rawUsageRows) {
      if (isAicReportingMonth(row.month, row.year)) {
        monthMap.set(`${row.year}-${row.month}`, {
          month: row.month,
          year: row.year,
        });
      }
    }

    const months = [...monthMap.values()].sort((left, right) => {
      if (left.year !== right.year) {
        return right.year - left.year;
      }

      return right.month - left.month;
    });

    return NextResponse.json({ months });
  } catch (error) {
    return handleRouteError(error, "GET /api/dashboard/months");
  }
}
