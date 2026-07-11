import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { TeamEntity } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity } from "@/entities/team-member-snapshot.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import {
  createTeamMembersSchema,
  teamMembersQuerySchema,
  teamMembersRemoveSchema,
} from "@/lib/validations/team-members";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import {
  parseEntityId,
  getCurrentMonthYear,
  invalidIdResponse,
  handleRouteError,
  validateBody,
  isValidationError,
} from "@/lib/api-helpers";
import { IsNull, In } from "typeorm";
import {
  getAllocationWarningsForSeats,
  normalizeAllocationPercentage,
} from "@/lib/team-allocation";

type RouteContext = { params: Promise<{ id: string }> };

async function ensureActiveTeamExists(id: number) {
  const dataSource = await getDb();
  const teamRepo = dataSource.getRepository(TeamEntity);
  const team = await teamRepo.findOne({
    where: { id, deletedAt: IsNull() },
  });

  return { dataSource, team };
}

async function validateSeatIds(
  seatRepo: ReturnType<(typeof import("typeorm"))["DataSource"]["prototype"]["getRepository"]>,
  seatIds: number[],
): Promise<number[]> {
  const existingSeats = await seatRepo.find({
    where: { id: In(seatIds) },
    select: { id: true },
  });
  const existingIds = new Set(existingSeats.map((seat) => seat.id));
  return seatIds.filter((seatId) => !existingIds.has(seatId));
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  const { id: idParam } = await context.params;
  const id = parseEntityId(idParam);
  if (id === null) {
    return invalidIdResponse("team");
  }

  const currentMonthYear = getCurrentMonthYear();
  const url = new URL(request.url);
  const parsedQuery = teamMembersQuerySchema.safeParse({
    month: url.searchParams.get("month") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsedQuery.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const month = parsedQuery.data.month ?? currentMonthYear.month;
  const year = parsedQuery.data.year ?? currentMonthYear.year;

  try {
    const { dataSource, team } = await ensureActiveTeamExists(id);
    if (!team) {
      return NextResponse.json(
        { error: "Team not found" },
        { status: 404 },
      );
    }

    const rows: {
      seatId: number;
      githubUsername: string;
      firstName: string | null;
      lastName: string | null;
      status: string;
      allocationPercentage: number;
    }[] = await dataSource.query(
      `SELECT
         tms."seatId",
         cs."githubUsername",
         cs."firstName",
         cs."lastName",
         cs."status",
         tms."allocationPercentage"
       FROM team_member_snapshot tms
       JOIN copilot_seat cs ON cs.id = tms."seatId"
       WHERE tms."teamId" = $1 AND tms.month = $2 AND tms.year = $3
       ORDER BY cs."githubUsername" ASC`,
      [id, month, year],
    );

    return NextResponse.json({
      members: rows.map((r) => ({
        seatId: r.seatId,
        githubUsername: r.githubUsername,
        firstName: r.firstName,
        lastName: r.lastName,
        status: r.status,
        allocationPercentage: r.allocationPercentage,
      })),
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/teams/[id]/members");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  const { id: idParam } = await context.params;
  const id = parseEntityId(idParam);
  if (id === null) {
    return invalidIdResponse("team");
  }

  const parsed = await validateBody(request, createTeamMembersSchema);
  if (isValidationError(parsed)) return parsed;

  const {
    seatIds,
    month,
    year,
    allocationPercentage: requestedAllocationPercentage,
  } = parsed.data;
  const allocationPercentage = normalizeAllocationPercentage(
    requestedAllocationPercentage,
  );

  try {
    const { dataSource, team } = await ensureActiveTeamExists(id);
    if (!team) {
      return NextResponse.json(
        { error: "Team not found" },
        { status: 404 },
      );
    }

    // Validate that all seatIds exist
    const seatRepo = dataSource.getRepository(CopilotSeatEntity);
    const invalidIds = await validateSeatIds(seatRepo, seatIds);
    if (invalidIds.length > 0) {
      return NextResponse.json(
        {
          error: "Some seat IDs do not exist",
          invalidSeatIds: invalidIds,
        },
        { status: 400 },
      );
    }

    // Count existing snapshots before insert so we can calculate how many were actually added
    const snapshotRepo = dataSource.getRepository(TeamMemberSnapshotEntity);
    const existingCount = await snapshotRepo.count({
      where: { teamId: id, month, year },
    });

    // Use raw query with ON CONFLICT DO NOTHING for idempotent inserts
    const values = seatIds
      .map((_, i) => `($1, $${i + 5}, $2, $3, $4)`)
      .join(", ");

    const params = [id, month, year, allocationPercentage, ...seatIds];

    await dataSource.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year", "allocationPercentage")
       VALUES ${values}
       ON CONFLICT ON CONSTRAINT "UQ_team_member_snapshot" DO NOTHING`,
      params,
    );

    const newCount = await snapshotRepo.count({
      where: { teamId: id, month, year },
    });
    const added = newCount - existingCount;
    const allocationWarnings = await getAllocationWarningsForSeats(
      dataSource,
      seatIds,
      month,
      year,
    );

    return NextResponse.json(
      { added, month, year, allocationPercentage, allocationWarnings },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/teams/[id]/members");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  const { id: idParam } = await context.params;
  const id = parseEntityId(idParam);
  if (id === null) {
    return invalidIdResponse("team");
  }

  const parsed = await validateBody(request, teamMembersRemoveSchema);
  if (isValidationError(parsed)) return parsed;

  const { seatIds, month, year, mode } = parsed.data;

  try {
    const { dataSource, team } = await ensureActiveTeamExists(id);
    if (!team) {
      return NextResponse.json(
        { error: "Team not found" },
        { status: 404 },
      );
    }

    const snapshotRepo = dataSource.getRepository(TeamMemberSnapshotEntity);

    if (mode === "purge") {
      const deleteResult = await snapshotRepo
        .createQueryBuilder()
        .delete()
        .where('"teamId" = :teamId AND "seatId" IN (:...seatIds)', {
          teamId: id,
          seatIds,
        })
        .execute();

      return NextResponse.json({
        removed: deleteResult.affected ?? 0,
        mode: "purge",
        month,
        year,
      });
    }

    const deleteResult = await snapshotRepo
      .createQueryBuilder()
      .delete()
      .where('"teamId" = :teamId AND "month" = :month AND "year" = :year AND "seatId" IN (:...seatIds)', {
        teamId: id,
        month,
        year,
        seatIds,
      })
      .execute();

    return NextResponse.json({
      removed: deleteResult.affected ?? 0,
      mode,
      month,
      year,
    });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/teams/[id]/members");
  }
}
