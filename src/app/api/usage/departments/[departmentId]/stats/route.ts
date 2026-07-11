import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DepartmentEntity } from "@/entities/department.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ departmentId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  const { departmentId: departmentIdParam } = await context.params;
  const departmentId = Number(departmentIdParam);
  if (!Number.isFinite(departmentId) || !Number.isInteger(departmentId) || departmentId < 1) {
    return NextResponse.json(
      { error: "Invalid department ID" },
      { status: 400 },
    );
  }

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
    const departmentRepo = dataSource.getRepository(DepartmentEntity);

    const department = await departmentRepo.findOne({ where: { id: departmentId } });
    if (!department) {
      return NextResponse.json(
        { error: "Department not found" },
        { status: 404 },
      );
    }

    const rows: {
      averageRequests: string | null;
      medianRequests: string | null;
      minRequests: string | null;
      maxRequests: string | null;
    }[] = await dataSource.query(
      `WITH member_requests AS (
         SELECT
           cs.id AS "seatId",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS total_requests
         FROM copilot_seat cs
         LEFT JOIN copilot_usage cu
           ON cu."seatId" = cs.id AND cu.month = $2 AND cu.year = $3
         LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
         WHERE cs."departmentId" = $1
         GROUP BY cs.id
       ),
       member_usage AS (
         SELECT
           total_requests
         FROM member_requests
       )
       SELECT
         ROUND(AVG(total_requests)::numeric, 1) AS "averageRequests",
         ROUND(
           (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_requests))::numeric,
           1
         ) AS "medianRequests",
         ROUND(MIN(total_requests)::numeric, 1) AS "minRequests",
         ROUND(MAX(total_requests)::numeric, 1) AS "maxRequests"
       FROM member_usage`,
      [departmentId, month, year],
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
    return handleRouteError(error, "GET /api/usage/departments/[departmentId]/stats");
  }
}
