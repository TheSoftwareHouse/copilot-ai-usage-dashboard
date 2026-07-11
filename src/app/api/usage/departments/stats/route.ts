import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";

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
    const rows: {
      averageRequests: string | null;
      medianRequests: string | null;
      minRequests: string | null;
      maxRequests: string | null;
    }[] = await dataSource.query(
      `WITH department_seats AS (
         SELECT cs."departmentId", cs.id AS "seatId"
         FROM copilot_seat cs
         WHERE cs."departmentId" IS NOT NULL
       ),
       seat_usage AS (
         SELECT
           ds."departmentId",
           ds."seatId",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS requests
         FROM department_seats ds
         LEFT JOIN copilot_usage cu
           ON cu."seatId" = ds."seatId" AND cu.month = $1 AND cu.year = $2
         LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
         GROUP BY ds."departmentId", ds."seatId"
       ),
       dept_aggregates AS (
         SELECT
           su."departmentId",
           COUNT(DISTINCT su."seatId") AS member_count,
           COALESCE(SUM(su.requests), 0) AS total_requests
         FROM seat_usage su
         GROUP BY su."departmentId"
       )
       SELECT
         ROUND(AVG(total_requests)::numeric, 1) AS "averageRequests",
         ROUND(
           (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_requests))::numeric,
           1
         ) AS "medianRequests",
         ROUND(MIN(total_requests)::numeric, 1) AS "minRequests",
         ROUND(MAX(total_requests)::numeric, 1) AS "maxRequests"
       FROM dept_aggregates
       WHERE member_count > 0`,
      [month, year],
    );

    const row = rows[0];

    return NextResponse.json({
      averageRequests: row?.averageRequests != null ? Number(row.averageRequests) : null,
      medianRequests: row?.medianRequests != null ? Number(row.medianRequests) : null,
      minRequests: row?.minRequests != null ? Number(row.minRequests) : null,
      maxRequests: row?.maxRequests != null ? Number(row.maxRequests) : null,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/departments/stats");
  }
}
