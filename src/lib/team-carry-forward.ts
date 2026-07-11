import { getDb } from "@/lib/db";
import {
  JobExecutionEntity,
} from "@/entities/job-execution.entity";
import { JobType, JobStatus } from "@/entities/enums";
import { ERROR_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { acquireJobLock } from "@/lib/job-lock";

export interface TeamCarryForwardResult {
  skipped: boolean;
  reason?: string;
  jobExecutionId?: number;
  status?: string;
  recordsProcessed?: number;
  errorMessage?: string;
}

/**
 * Calculate the previous month and year, handling December → January rollover.
 */
function getPreviousMonth(month: number, year: number): { month: number; year: number } {
  if (month === 1) {
    return { month: 12, year: year - 1 };
  }
  return { month: month - 1, year };
}

/**
 * Execute a carry-forward of team member snapshots from the previous month
 * to the current month for every active (non-deleted) team.
 *
 * The operation is idempotent: the SQL uses ON CONFLICT DO NOTHING so running
 * it multiple times creates no duplicates. Additionally, if a successful
 * carry-forward job already exists for the current month, the function skips.
 *
 * Concurrency guard: only one carry-forward job can run at a time.
 */
export async function executeTeamCarryForward(): Promise<TeamCarryForwardResult> {
  const dataSource = await getDb();
  const jobRepository = dataSource.getRepository(JobExecutionEntity);

  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  const prev = getPreviousMonth(currentMonth, currentYear);

  // Concurrency guard with preCheck: skip if already completed for this month
  const lockResult = await acquireJobLock(
    dataSource,
    JobType.TEAM_CARRY_FORWARD,
    {
      preCheck: async (manager) => {
        const completedJob = await manager
          .getRepository(JobExecutionEntity)
          .findOne({
            where: {
              jobType: JobType.TEAM_CARRY_FORWARD,
              status: JobStatus.SUCCESS,
            },
            order: { startedAt: "DESC" },
            lock: { mode: "pessimistic_write" },
          });

        if (completedJob) {
          const completedMonth = completedJob.startedAt.getUTCMonth() + 1;
          const completedYear = completedJob.startedAt.getUTCFullYear();

          if (completedMonth === currentMonth && completedYear === currentYear) {
            return { skip: true, reason: "already_completed" };
          }
        }

        return { skip: false };
      },
    },
  );
  if (!lockResult.acquired) {
    const level = lockResult.reason === "already_completed" ? "log" : "warn";
    console[level](`Team carry-forward skipped: ${lockResult.reason}`);
    return { skipped: true, reason: lockResult.reason };
  }
  const jobExecution = lockResult.jobExecution;

  console.log(
    `Team carry-forward started: ${prev.month}/${prev.year} → ${currentMonth}/${currentYear} (JobExecution #${jobExecution.id})`,
  );

  try {
    // Copy snapshots from previous month to current month for all active teams.
    // ON CONFLICT DO NOTHING makes this idempotent.
    // RETURNING id gives us the exact count of inserted rows.
    const insertedRows = await dataSource.query(
      `INSERT INTO team_member_snapshot ("teamId", "seatId", "month", "year", "allocationPercentage")
       SELECT tms."teamId", tms."seatId", $1, $2, tms."allocationPercentage"
       FROM team_member_snapshot tms
       JOIN team t ON t.id = tms."teamId" AND t."deletedAt" IS NULL
       WHERE tms.month = $3 AND tms.year = $4
       ON CONFLICT ON CONSTRAINT "UQ_team_member_snapshot" DO NOTHING
       RETURNING id`,
      [currentMonth, currentYear, prev.month, prev.year],
    );

    const recordsProcessed = insertedRows.length;

    // Update job execution — SUCCESS
    await jobRepository.save({
      ...jobExecution,
      status: JobStatus.SUCCESS,
      completedAt: new Date(),
      recordsProcessed,
    });

    console.log(
      `Team carry-forward completed: ${recordsProcessed} snapshots carried forward`,
    );

    return {
      skipped: false,
      jobExecutionId: jobExecution.id,
      status: JobStatus.SUCCESS,
      recordsProcessed,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const truncatedMessage = errorMessage.substring(
      0,
      ERROR_MESSAGE_MAX_LENGTH,
    );

    // Update job execution — FAILURE
    await jobRepository.save({
      ...jobExecution,
      status: JobStatus.FAILURE,
      completedAt: new Date(),
      errorMessage: truncatedMessage,
    });

    console.error(`Team carry-forward failed: ${truncatedMessage}`);

    return {
      skipped: false,
      jobExecutionId: jobExecution.id,
      status: JobStatus.FAILURE,
      errorMessage: truncatedMessage,
    };
  }
}
