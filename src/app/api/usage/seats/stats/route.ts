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
      `WITH seat_requests AS (
         SELECT
           cu."seatId",
           SUM((item->>'grossQuantity')::numeric) AS total_requests
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."month" = $1 AND cu."year" = $2
         GROUP BY cu."seatId"
       )
       SELECT
         ROUND(AVG(total_requests)::numeric, 1) AS "averageRequests",
         ROUND(
           (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_requests))::numeric,
           1
         ) AS "medianRequests",
         ROUND(MIN(total_requests)::numeric, 1) AS "minRequests",
         ROUND(MAX(total_requests)::numeric, 1) AS "maxRequests"
       FROM seat_requests`,
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
    return handleRouteError(error, "GET /api/usage/seats/stats");
  }
}
