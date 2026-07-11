import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DepartmentEntity } from "@/entities/department.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { calculateUsageCostMetrics } from "@/lib/usage-cost-metrics";

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

    // Per-member usage aggregation
    const memberRows: {
      seatId: number;
      githubUsername: string;
      firstName: string | null;
      lastName: string | null;
      totalRequests: string;
      totalGrossAmount: string;
    }[] = await dataSource.query(
      `SELECT
         cs.id AS "seatId",
         cs."githubUsername",
         cs."firstName",
         cs."lastName",
         COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests",
         COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "totalGrossAmount"
       FROM copilot_seat cs
       LEFT JOIN copilot_usage cu
         ON cu."seatId" = cs.id AND cu.month = $2 AND cu.year = $3
       LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
       WHERE cs."departmentId" = $1
       GROUP BY cs.id, cs."githubUsername", cs."firstName", cs."lastName"
       ORDER BY COALESCE(SUM((item->>'grossQuantity')::numeric), 0) DESC`,
      [departmentId, month, year],
    );

    const members = memberRows.map((row) => ({
      seatId: row.seatId,
      githubUsername: row.githubUsername,
      firstName: row.firstName,
      lastName: row.lastName,
      totalRequests: Number(row.totalRequests),
      totalGrossAmount: Number(row.totalGrossAmount),
    }));

    // Department-level aggregates
    const memberCount = members.length;
    const totalRequests = members.reduce((sum, m) => sum + m.totalRequests, 0);
    const totalGrossAmount = members.reduce((sum, m) => sum + m.totalGrossAmount, 0);
    const averageRequestsPerMember =
      memberCount > 0 ? totalRequests / memberCount : 0;

    const dailyRows: {
      seatId: number;
      githubUsername: string;
      day: number | null;
      totalRequests: string;
      totalGrossAmount: string;
    }[] = await dataSource.query(
      `SELECT
         cs.id AS "seatId",
         cs."githubUsername",
         cu."day",
         COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests",
         COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "totalGrossAmount"
       FROM copilot_seat cs
       LEFT JOIN copilot_usage cu
         ON cu."seatId" = cs.id AND cu.month = $2 AND cu.year = $3
       LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
       WHERE cs."departmentId" = $1
       GROUP BY cs.id, cs."githubUsername", cu."day"
       ORDER BY cs.id, cu."day"`,
      [departmentId, month, year],
    );

    const dailyMap = new Map<
      number,
      { seatId: number; githubUsername: string; days: { day: number; totalRequests: number }[] }
    >();
    const dailyGrossQuantity = new Map<number, number>();

    for (const row of dailyRows) {
      if (!dailyMap.has(row.seatId)) {
        dailyMap.set(row.seatId, {
          seatId: row.seatId,
          githubUsername: row.githubUsername,
          days: [],
        });
      }
      if (row.day !== null) {
        dailyMap.get(row.seatId)!.days.push({
          day: row.day,
          totalRequests: Number(row.totalRequests),
        });
        dailyGrossQuantity.set(
          row.day,
          (dailyGrossQuantity.get(row.day) ?? 0) + Number(row.totalRequests),
        );
      }
    }

    const dailyUsagePerMember = Array.from(dailyMap.values());
    const costStats = calculateUsageCostMetrics({
      month,
      year,
      dailyGrossQuantity: Array.from(dailyGrossQuantity, ([day, grossQuantity]) => ({
        day,
        grossQuantity,
      })),
    });

    return NextResponse.json({
      department: {
        departmentId: department.id,
        departmentName: department.name,
        memberCount,
        totalRequests,
        totalGrossAmount,
        averageRequestsPerMember,
      },
      members,
      dailyUsagePerMember,
      costStats,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/departments/[departmentId]");
  }
}
