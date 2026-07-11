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
      teamId: number;
      teamName: string;
      memberCount: string;
      totalAllocatedRequests: string;
      totalGrossAmount: string;
    }[] = await dataSource.query(
      `WITH team_members AS (
         SELECT tms."teamId", tms."seatId", tms."allocationPercentage"
         FROM team_member_snapshot tms
         WHERE tms.month = $1 AND tms.year = $2
       ),
       member_usage AS (
         SELECT
           tm."teamId",
           tm."seatId",
           tm."allocationPercentage",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS requests,
           COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "grossAmount"
         FROM team_members tm
         LEFT JOIN copilot_usage cu
           ON cu."seatId" = tm."seatId" AND cu.month = $1 AND cu.year = $2
         LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
         GROUP BY tm."teamId", tm."seatId", tm."allocationPercentage"
       ),
       team_aggregates AS (
         SELECT
           mu."teamId",
           COUNT(DISTINCT mu."seatId") AS "memberCount",
           COALESCE(SUM((mu.requests * mu."allocationPercentage") / 100), 0) AS "totalAllocatedRequests",
           COALESCE(SUM((mu."grossAmount" * mu."allocationPercentage") / 100), 0) AS "totalGrossAmount"
         FROM member_usage mu
         GROUP BY mu."teamId"
       )
       SELECT
         t.id AS "teamId",
         t.name AS "teamName",
         COALESCE(ta."memberCount", 0)::int AS "memberCount",
         COALESCE(ta."totalAllocatedRequests", 0) AS "totalAllocatedRequests",
         COALESCE(ta."totalGrossAmount", 0) AS "totalGrossAmount"
       FROM team t
       LEFT JOIN team_aggregates ta ON ta."teamId" = t.id
       ORDER BY
         COALESCE(ta."totalAllocatedRequests", 0) DESC,
         t.name ASC`,
       [month, year],
    );

    const teams = rows.map((row) => {
      const memberCount = Number(row.memberCount);
      const totalRequests = Number(row.totalAllocatedRequests);
      const totalGrossAmount = Number(row.totalGrossAmount);

      return {
        teamId: row.teamId,
        teamName: row.teamName,
        memberCount,
        totalRequests,
        totalGrossAmount,
        totalCost: totalGrossAmount,
        averageRequestsPerMember:
          memberCount > 0 ? totalRequests / memberCount : 0,
        averageGrossAmountPerMember:
          memberCount > 0 ? totalGrossAmount / memberCount : 0,
      };
    });

    return NextResponse.json({
      teams,
      total: teams.length,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/teams");
  }
}
