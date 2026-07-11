import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import {
  calculateAllocatedGrossAmount,
  calculateAllocatedRequests,
} from "@/lib/team-allocation";
import { calculateNorm, calculateDeviation } from "@/lib/norm-calculation";
import { calculateUsageCostMetrics } from "@/lib/usage-cost-metrics";

type RouteContext = { params: Promise<{ seatId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  const { seatId: seatIdParam } = await context.params;
  const seatId = Number(seatIdParam);
  if (!Number.isFinite(seatId) || !Number.isInteger(seatId) || seatId < 1) {
    return NextResponse.json(
      { error: "Invalid seat ID" },
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
    const seatRepo = dataSource.getRepository(CopilotSeatEntity);

    const seat = await seatRepo.findOne({ where: { id: seatId } });
    if (!seat) {
      return NextResponse.json(
        { error: "Seat not found" },
        { status: 404 },
      );
    }

    // Daily usage aggregation: SUM(grossQuantity), SUM(grossAmount) grouped by day
    const dailyRows: { day: number; totalRequests: string; grossAmount: string }[] =
      await dataSource.query(
        `SELECT
           cu."day",
           SUM((item->>'grossQuantity')::numeric) AS "totalRequests",
           SUM((item->>'grossAmount')::numeric) AS "grossAmount"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."seatId" = $1 AND cu."month" = $2 AND cu."year" = $3
         GROUP BY cu."day"
         ORDER BY cu."day" ASC`,
        [seatId, month, year],
      );

    const { normValue, warningThreshold, alertThreshold } =
      await calculateNorm(month, year);

    const dailyUsage = dailyRows.map((row) => {
      const totalRequests = Number(row.totalRequests);
      return {
        day: row.day,
        totalRequests,
        grossAmount: Number(row.grossAmount),
        deviation: calculateDeviation(
          totalRequests,
          normValue,
          warningThreshold,
          alertThreshold,
        ),
      };
    });

    // Model breakdown aggregation: SUM per model
    const modelRows: { model: string; totalRequests: string; grossAmount: string; netAmount: string }[] =
      await dataSource.query(
        `SELECT
           item->>'model' AS "model",
           SUM((item->>'grossQuantity')::numeric) AS "totalRequests",
           SUM((item->>'grossAmount')::numeric) AS "grossAmount",
           SUM((item->>'netAmount')::numeric) AS "netAmount"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."seatId" = $1 AND cu."month" = $2 AND cu."year" = $3
         GROUP BY item->>'model'
         ORDER BY "totalRequests" DESC`,
        [seatId, month, year],
      );

    const modelBreakdown = modelRows.map((row) => ({
      model: row.model,
      totalRequests: Number(row.totalRequests),
      grossAmount: Number(row.grossAmount),
      netAmount: Number(row.netAmount),
    }));

    // Summary totals
    const summaryResult: { totalRequests: string | null; grossSpending: string | null; netSpending: string | null }[] =
      await dataSource.query(
        `SELECT
           SUM((item->>'grossQuantity')::numeric) AS "totalRequests",
           SUM((item->>'grossAmount')::numeric) AS "grossSpending",
           SUM((item->>'netAmount')::numeric) AS "netSpending"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."seatId" = $1 AND cu."month" = $2 AND cu."year" = $3`,
        [seatId, month, year],
      );

    const summary = {
      totalRequests: Number(summaryResult[0]?.totalRequests ?? 0),
      grossSpending: Number(summaryResult[0]?.grossSpending ?? 0),
      netSpending: Number(summaryResult[0]?.netSpending ?? 0),
    };

    // Team memberships for this seat in the selected month
    const teamRows: { teamId: number; teamName: string; allocationPercentage: number }[] =
      await dataSource.query(
        `SELECT t.id AS "teamId", t.name AS "teamName", tms."allocationPercentage"
         FROM team_member_snapshot tms
         JOIN team t ON t.id = tms."teamId"
         WHERE tms."seatId" = $1 AND tms.month = $2 AND tms.year = $3
           AND t."deletedAt" IS NULL
         ORDER BY t.name ASC`,
        [seatId, month, year],
      );

    const teams = teamRows.map((row) => ({
      teamId: Number(row.teamId),
      teamName: row.teamName,
      allocationPercentage: row.allocationPercentage,
      allocatedRequests: calculateAllocatedRequests(
        summary.totalRequests,
        row.allocationPercentage,
      ),
      allocatedGrossAmount: calculateAllocatedGrossAmount(
        summary.grossSpending,
        row.allocationPercentage,
      ),
    }));

    const costStats = calculateUsageCostMetrics({
      month,
      year,
      dailyGrossQuantity: dailyRows.map((row) => ({
        day: row.day,
        grossQuantity: Number(row.totalRequests),
      })),
    });

    return NextResponse.json({
      seat: {
        seatId: seat.id,
        githubUsername: seat.githubUsername,
        firstName: seat.firstName,
        lastName: seat.lastName,
        department: seat.department,
        departmentId: seat.departmentId,
      },
      summary,
      dailyUsage,
      modelBreakdown,
      teams,
      costStats,
      month,
      year,
      normValue,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/seats/[seatId]");
  }
}
