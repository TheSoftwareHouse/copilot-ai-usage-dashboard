import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { TeamEntity } from "@/entities/team.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { calculateUsageCostMetrics } from "@/lib/usage-cost-metrics";
import {
  calculateAllocatedGrossAmount,
  calculateAllocatedRequests,
} from "@/lib/team-allocation";

type RouteContext = { params: Promise<{ teamId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  const { teamId: teamIdParam } = await context.params;
  const teamId = Number(teamIdParam);
  if (!Number.isFinite(teamId) || !Number.isInteger(teamId) || teamId < 1) {
    return NextResponse.json({ error: "Invalid team ID" }, { status: 400 });
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
    const teamRepo = dataSource.getRepository(TeamEntity);

    const team = await teamRepo.findOne({ where: { id: teamId } });
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const memberRows: {
      seatId: number;
      githubUsername: string;
      firstName: string | null;
      lastName: string | null;
      allocationPercentage: number;
      totalRequests: string;
      totalGrossAmount: string;
    }[] = await dataSource.query(
      `SELECT
         tms."seatId",
         cs."githubUsername",
         cs."firstName",
         cs."lastName",
         tms."allocationPercentage",
         COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests",
         COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "totalGrossAmount"
       FROM team_member_snapshot tms
       JOIN copilot_seat cs ON cs.id = tms."seatId"
       LEFT JOIN copilot_usage cu
         ON cu."seatId" = tms."seatId" AND cu.month = $2 AND cu.year = $3
       LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
       WHERE tms."teamId" = $1 AND tms.month = $2 AND tms.year = $3
       GROUP BY tms."seatId", cs."githubUsername", cs."firstName", cs."lastName", tms."allocationPercentage"
       ORDER BY COALESCE(SUM((item->>'grossQuantity')::numeric), 0) DESC`,
      [teamId, month, year],
    );

    const members = memberRows.map((row) => ({
      seatId: row.seatId,
      githubUsername: row.githubUsername,
      firstName: row.firstName,
      lastName: row.lastName,
      allocationPercentage: row.allocationPercentage,
      totalRequests: Number(row.totalRequests),
      allocatedRequests: calculateAllocatedRequests(
        Number(row.totalRequests),
        row.allocationPercentage,
      ),
      totalGrossAmount: calculateAllocatedGrossAmount(
        Number(row.totalGrossAmount),
        row.allocationPercentage,
      ),
    }));

    const memberCount = members.length;
    const totalRequests = members.reduce(
      (sum, member) => sum + (member.allocatedRequests ?? 0),
      0,
    );
    const totalGrossAmount = members.reduce((sum, member) => sum + member.totalGrossAmount, 0);

    const dailyRows: {
      seatId: number;
      githubUsername: string;
      day: number | null;
      totalRequests: string;
      totalGrossAmount: string;
    }[] = await dataSource.query(
      `SELECT
         tms."seatId",
         cs."githubUsername",
         cu."day",
         COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests",
         COALESCE(SUM((item->>'grossAmount')::numeric), 0) AS "totalGrossAmount"
       FROM team_member_snapshot tms
       JOIN copilot_seat cs ON cs.id = tms."seatId"
       LEFT JOIN copilot_usage cu
         ON cu."seatId" = tms."seatId" AND cu.month = $2 AND cu.year = $3
       LEFT JOIN LATERAL jsonb_array_elements(cu."usageItems") AS item ON true
       WHERE tms."teamId" = $1 AND tms.month = $2 AND tms.year = $3
       GROUP BY tms."seatId", cs."githubUsername", cu."day"
       ORDER BY tms."seatId", cu."day"`,
      [teamId, month, year],
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
      team: {
        teamId: team.id,
        teamName: team.name,
        memberCount,
        totalRequests,
        totalGrossAmount,
        totalCost: totalGrossAmount,
        averageRequestsPerMember: memberCount > 0 ? totalRequests / memberCount : 0,
        averageGrossAmountPerMember:
          memberCount > 0 ? totalGrossAmount / memberCount : 0,
      },
      members,
      dailyUsagePerMember,
      costStats,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/teams/[teamId]");
  }
}
