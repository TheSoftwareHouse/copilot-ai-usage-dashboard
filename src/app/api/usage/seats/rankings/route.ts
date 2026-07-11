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
    type RankingRow = {
      seatId: number;
      githubUsername: string;
      firstName: string | null;
      lastName: string | null;
      totalRequests: string;
      rank_desc: string;
      rank_asc: string;
    };

    const rows: RankingRow[] = await dataSource.query(
      `WITH seat_requests AS (
         SELECT
           cs.id AS "seatId",
           cs."githubUsername",
           cs."firstName",
           cs."lastName",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS total_requests
         FROM copilot_seat cs
         LEFT JOIN copilot_usage cu
           ON cu."seatId" = cs.id AND cu."month" = $1 AND cu."year" = $2
         LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
         WHERE cs.status = 'active'
         GROUP BY cs.id, cs."githubUsername", cs."firstName", cs."lastName"
       ),
       ranked AS (
         SELECT
           sr."seatId",
           sr."githubUsername",
           sr."firstName",
           sr."lastName",
           ROUND(sr.total_requests::numeric, 0) AS "totalRequests",
           ROW_NUMBER() OVER (ORDER BY
             sr.total_requests DESC
           ) AS rank_desc,
           ROW_NUMBER() OVER (ORDER BY
             sr.total_requests ASC
           ) AS rank_asc
         FROM seat_requests sr
       )
       SELECT *
       FROM ranked
       WHERE rank_desc <= 5 OR rank_asc <= 5`,
      [month, year],
    );

    const mapRow = (row: RankingRow) => ({
      seatId: row.seatId,
      githubUsername: row.githubUsername,
      firstName: row.firstName,
      lastName: row.lastName,
      totalRequests: Number(row.totalRequests),
    });

    const mostActive = rows
      .filter((r) => Number(r.rank_desc) <= 5)
      .sort((a, b) => Number(a.rank_desc) - Number(b.rank_desc))
      .map(mapRow);
    const leastActive = rows
      .filter((r) => Number(r.rank_asc) <= 5)
      .sort((a, b) => Number(a.rank_asc) - Number(b.rank_asc))
      .map(mapRow);

    return NextResponse.json({
      mostActive,
      leastActive,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/seats/rankings");
  }
}
