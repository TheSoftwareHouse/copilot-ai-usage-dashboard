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
      departmentId: number;
      departmentName: string;
      memberCount: string;
      totalRequests: string;
      totalGrossAmount: string;
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
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS requests,
           COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "grossAmount"
         FROM department_seats ds
         LEFT JOIN copilot_usage cu
           ON cu."seatId" = ds."seatId" AND cu.month = $1 AND cu.year = $2
         LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
         GROUP BY ds."departmentId", ds."seatId"
       ),
       dept_aggregates AS (
         SELECT
           su."departmentId",
           COUNT(DISTINCT su."seatId") AS "memberCount",
           COALESCE(SUM(su.requests), 0) AS "totalRequests",
           COALESCE(SUM(su."grossAmount"), 0) AS "totalGrossAmount"
         FROM seat_usage su
         GROUP BY su."departmentId"
       )
       SELECT
         d.id AS "departmentId",
         d.name AS "departmentName",
         COALESCE(da."memberCount", 0)::int AS "memberCount",
         COALESCE(da."totalRequests", 0) AS "totalRequests",
         COALESCE(da."totalGrossAmount", 0) AS "totalGrossAmount"
       FROM department d
       LEFT JOIN dept_aggregates da ON da."departmentId" = d.id
       ORDER BY
        COALESCE(da."totalRequests", 0) DESC`,
      [month, year],
    );

    const departments = rows.map((row) => {
      const memberCount = Number(row.memberCount);
      const totalRequests = Number(row.totalRequests);
      const totalGrossAmount = Number(row.totalGrossAmount);
      const averageRequestsPerMember =
        memberCount > 0 ? totalRequests / memberCount : 0;
      return {
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        memberCount,
        totalRequests,
        totalGrossAmount,
        averageRequestsPerMember,
      };
    });

    return NextResponse.json({
      departments,
      total: departments.length,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/departments");
  }
}
