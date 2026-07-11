import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DepartmentEntity } from "@/entities/department.entity";
import { createDepartmentSchema } from "@/lib/validations/department";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { validateBody, isValidationError, handleRouteError } from "@/lib/api-helpers";

export async function GET() {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const dataSource = await getDb();

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    const rows: {
      id: number;
      name: string;
      createdAt: Date;
      updatedAt: Date;
      seatCount: string;
      totalRequests: string;
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
           COUNT(DISTINCT su."seatId") AS "seatCount",
           COALESCE(SUM(su.requests), 0) AS "totalRequests"
         FROM seat_usage su
         GROUP BY su."departmentId"
       )
       SELECT
         d.id, d.name, d."createdAt", d."updatedAt",
         COALESCE(da."seatCount", 0)::text AS "seatCount",
         COALESCE(da."totalRequests", 0)::text AS "totalRequests"
       FROM department d
       LEFT JOIN dept_aggregates da ON da."departmentId" = d.id
       ORDER BY d.name ASC`,
      [month, year],
    );

    return NextResponse.json({
      departments: rows.map((r) => {
        const seatCount = Number(r.seatCount);
        const totalRequests = Number(r.totalRequests);
        return {
          id: r.id,
          name: r.name,
          seatCount,
          totalAiCredits: totalRequests,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/departments");
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  const parsed = await validateBody(request, createDepartmentSchema);
  if (isValidationError(parsed)) return parsed;

  const { name } = parsed.data;

  try {
    const dataSource = await getDb();
    const deptRepo = dataSource.getRepository(DepartmentEntity);

    const dept = deptRepo.create({ name });
    const saved = await deptRepo.save(dept);

    return NextResponse.json(
      {
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/departments", {
      uniqueViolationMessage: "Department name already exists",
    });
  }
}
