import { NextResponse } from "next/server";
import { JobExecutionEntity, type JobExecution } from "@/entities/job-execution.entity";
import { JobType } from "@/entities/enums";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";

function serializeJobExecution(execution: JobExecution | null) {
  if (!execution) {
    return null;
  }

  return {
    id: execution.id,
    jobType: execution.jobType,
    status: execution.status,
    reason: execution.reason,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    errorMessage: execution.errorMessage,
    recordsProcessed: execution.recordsProcessed,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const dataSource = await getDb();
    const repository = dataSource.getRepository(JobExecutionEntity);

    const [seatSync, teamCarryForward, usageCollection, monthRecollection] = await Promise.all(
      [
        JobType.SEAT_SYNC,
        JobType.TEAM_CARRY_FORWARD,
        JobType.USAGE_COLLECTION,
        JobType.MONTH_RECOLLECTION,
      ].map((jobType) =>
        repository.findOne({
          where: { jobType },
          order: { startedAt: "DESC" },
        }),
      ),
    );

    return NextResponse.json({
      seatSync: serializeJobExecution(seatSync),
      teamCarryForward: serializeJobExecution(teamCarryForward),
      usageCollection: serializeJobExecution(usageCollection),
      retiredJobs: {
        // Compatibility alias for existing clients reading retiredJobs.usageCollection.
        usageCollection: serializeJobExecution(usageCollection),
        monthRecollection: serializeJobExecution(monthRecollection),
      },
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/job-status");
  }
}
