import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const SORTABLE_FIELDS = new Set(["totalRequests", "githubUsername", "department"]);

const SORT_COLUMN_MAP: Record<string, string> = {
  totalRequests: '"totalRequests"',
  githubUsername: 'cs."githubUsername"',
  department: 'cs."department"',
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const { searchParams } = request.nextUrl;

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    let page = parseInt(searchParams.get("page") ?? "", 10);
    if (isNaN(page) || page < 1) page = DEFAULT_PAGE;

    let pageSize = parseInt(searchParams.get("pageSize") ?? "", 10);
    if (isNaN(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
    if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

    const sortByParam = searchParams.get("sortBy") ?? "";
    const sortBy = SORTABLE_FIELDS.has(sortByParam) ? sortByParam : "totalRequests";

    const sortOrderParam = (searchParams.get("sortOrder") ?? "").toLowerCase();
    const sortOrder: "asc" | "desc" = sortOrderParam === "desc" ? "desc" : "asc";

    const orderByClause = `${SORT_COLUMN_MAP[sortBy]} ${sortOrder === "asc" ? "ASC" : "DESC"}`;

    const dataSource = await getDb();

    const countResult: { count: string }[] = await dataSource.query(
      `WITH seat_usage AS (
         SELECT cu."seatId",
                COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu.month = $1 AND cu.year = $2
         GROUP BY cu."seatId"
       )
       SELECT COUNT(*) AS "count"
       FROM copilot_seat cs
       LEFT JOIN seat_usage su ON su."seatId" = cs.id
       WHERE cs.status = 'active'
        AND COALESCE(su."totalRequests", 0) >= 0`,
      [month, year],
    );

    const total = parseInt(countResult[0]?.count ?? "0", 10);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;

    if (total === 0) {
      return NextResponse.json({
        seats: [],
        total: 0,
        page,
        pageSize,
        totalPages: 1,
      });
    }

    const rows: {
      seatId: number;
      githubUsername: string;
      firstName: string | null;
      lastName: string | null;
      department: string | null;
      totalRequests: string;
    }[] = await dataSource.query(
      `WITH seat_usage AS (
         SELECT cu."seatId",
                COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu.month = $1 AND cu.year = $2
         GROUP BY cu."seatId"
       )
       SELECT cs.id AS "seatId",
              cs."githubUsername",
              cs."firstName",
              cs."lastName",
              cs."department",
                COALESCE(su."totalRequests", 0) AS "totalRequests"
       FROM copilot_seat cs
       LEFT JOIN seat_usage su ON su."seatId" = cs.id
       WHERE cs.status = 'active'
         AND COALESCE(su."totalRequests", 0) >= 0
       ORDER BY ${orderByClause}
      LIMIT $3 OFFSET $4`,
      [month, year, pageSize, offset],
    );

    const seats = rows.map((row) => ({
      seatId: row.seatId,
      githubUsername: row.githubUsername,
      firstName: row.firstName,
      lastName: row.lastName,
      department: row.department,
      totalRequests: Number(row.totalRequests),
    }));

    return NextResponse.json({
      seats,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/seats/low-usage");
  }
}
