import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { TeamEntity } from "@/entities/team.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { teamMembersBackfillSchema } from "@/lib/validations/team-members";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import {
  parseEntityId,
  invalidIdResponse,
  handleRouteError,
  validateBody,
  isValidationError,
} from "@/lib/api-helpers";
import { IsNull, In } from "typeorm";
import { DEFAULT_ALLOCATION_PERCENTAGE } from "@/lib/team-allocation";

type RouteContext = { params: Promise<{ id: string }> };

function generateMonthRange(
  startMonth: number,
  startYear: number,
  endMonth: number,
  endYear: number,
): { month: number; year: number }[] {
  const months: { month: number; year: number }[] = [];
  let m = startMonth;
  let y = startYear;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push({ month: m, year: y });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  const { id: idParam } = await context.params;
  const id = parseEntityId(idParam);
  if (id === null) {
    return invalidIdResponse("team");
  }

  const parsed = await validateBody(request, teamMembersBackfillSchema);
  if (isValidationError(parsed)) return parsed;

  const { seatIds, startMonth, startYear, endMonth, endYear } = parsed.data;

  try {
    const dataSource = await getDb();
    const teamRepo = dataSource.getRepository(TeamEntity);

    const team = await teamRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!team) {
      return NextResponse.json(
        { error: "Team not found" },
        { status: 404 },
      );
    }

    // Validate that all seatIds exist
    const seatRepo = dataSource.getRepository(CopilotSeatEntity);
    const existingSeats = await seatRepo.find({
      where: { id: In(seatIds) },
      select: { id: true },
    });
    const existingIds = new Set(existingSeats.map((s) => s.id));
    const invalidIds = seatIds.filter((sid) => !existingIds.has(sid));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        {
          error: "Some seat IDs do not exist",
          invalidSeatIds: invalidIds,
        },
        { status: 400 },
      );
    }

    const monthRange = generateMonthRange(startMonth, startYear, endMonth, endYear);
    const totalMonthsInRange = monthRange.length;

    // Build bulk INSERT values: (teamId, seatId, month, year, allocationPercentage)
    // Params layout: $1 = teamId, then triplets of (seatId, month, year) per combination.
    const valueParts: string[] = [];
    const params: (number)[] = [id];
    let paramIdx = 2;

    for (const { month, year } of monthRange) {
      for (const seatId of seatIds) {
        valueParts.push(
          `($1, $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, ${DEFAULT_ALLOCATION_PERCENTAGE})`,
        );
        params.push(seatId, month, year);
        paramIdx += 3;
      }
    }

    // Count existing snapshots for this team within the range to compute added count
    const existingCountResult: { count: string }[] = await dataSource.query(
      `SELECT COUNT(*)::text AS count
       FROM team_member_snapshot
       WHERE "teamId" = $1
         AND "seatId" = ANY($2)
         AND (year * 12 + month) >= $3
         AND (year * 12 + month) <= $4`,
      [
        id,
        seatIds,
        startYear * 12 + startMonth,
        endYear * 12 + endMonth,
      ],
    );
    const beforeCount = parseInt(existingCountResult[0].count, 10);

    await dataSource.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year", "allocationPercentage")
       VALUES ${valueParts.join(", ")}
       ON CONFLICT ON CONSTRAINT "UQ_team_member_snapshot" DO NOTHING`,
      params,
    );

    // Count after insert to determine how many were actually added
    const afterCountResult: { count: string }[] = await dataSource.query(
      `SELECT COUNT(*)::text AS count
       FROM team_member_snapshot
       WHERE "teamId" = $1
         AND "seatId" = ANY($2)
         AND (year * 12 + month) >= $3
         AND (year * 12 + month) <= $4`,
      [
        id,
        seatIds,
        startYear * 12 + startMonth,
        endYear * 12 + endMonth,
      ],
    );
    const afterCount = parseInt(afterCountResult[0].count, 10);
    const added = afterCount - beforeCount;

    return NextResponse.json(
      { added, totalMonthsInRange, startMonth, startYear, endMonth, endYear },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/teams/[id]/members/backfill");
  }
}
