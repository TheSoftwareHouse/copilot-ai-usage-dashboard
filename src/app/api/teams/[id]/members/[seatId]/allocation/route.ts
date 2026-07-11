import { NextResponse } from "next/server";
import { IsNull } from "typeorm";
import { TeamEntity } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity } from "@/entities/team-member-snapshot.entity";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import {
  handleRouteError,
  invalidIdResponse,
  isValidationError,
  parseEntityId,
  validateBody,
} from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { updateTeamMemberAllocationSchema } from "@/lib/validations/team-members";
import {
  getAllocationWarningForSeat,
} from "@/lib/team-allocation";

type RouteContext = { params: Promise<{ id: string; seatId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  const { id: idParam, seatId: seatIdParam } = await context.params;
  const teamId = parseEntityId(idParam);
  if (teamId === null) {
    return invalidIdResponse("team");
  }

  const seatId = parseEntityId(seatIdParam);
  if (seatId === null) {
    return invalidIdResponse("seat");
  }

  const parsed = await validateBody(request, updateTeamMemberAllocationSchema);
  if (isValidationError(parsed)) return parsed;

  const { month, year, allocationPercentage } = parsed.data;

  try {
    const dataSource = await getDb();
    const teamRepo = dataSource.getRepository(TeamEntity);
    const snapshotRepo = dataSource.getRepository(TeamMemberSnapshotEntity);

    const team = await teamRepo.findOne({
      where: { id: teamId, deletedAt: IsNull() },
    });
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const snapshot = await snapshotRepo.findOne({
      where: { teamId, seatId, month, year },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Team member snapshot not found" },
        { status: 404 },
      );
    }

    await snapshotRepo.update(snapshot.id, { allocationPercentage });

    const allocationWarning = await getAllocationWarningForSeat(
      dataSource,
      seatId,
      month,
      year,
    );

    return NextResponse.json({
      seatId,
      month,
      year,
      allocationPercentage,
      allocationWarning,
    });
  } catch (error) {
    return handleRouteError(
      error,
      "PATCH /api/teams/[id]/members/[seatId]/allocation",
    );
  }
}