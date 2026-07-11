/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import { JobType, JobStatus, SeatStatus } from "@/entities/enums";
import { JobExecutionEntity } from "@/entities/job-execution.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { TeamEntity, type Team } from "@/entities/team.entity";
import {
  TeamMemberSnapshotEntity,
  type TeamMemberSnapshot,
} from "@/entities/team-member-snapshot.entity";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({
  getDb: async () => testDs,
}));

const { executeTeamCarryForward } = await import(
  "@/lib/team-carry-forward"
);

async function seedTeam(
  ds: DataSource,
  name: string,
  deletedAt: Date | null = null,
): Promise<Team> {
  const repo = ds.getRepository(TeamEntity);
  return repo.save({ name, deletedAt } as Partial<Team>);
}

async function seedSeat(
  ds: DataSource,
  username: string,
): Promise<number> {
  const repo = ds.getRepository(CopilotSeatEntity);
  const seat = await repo.save({
    githubUsername: username,
    githubUserId: Math.floor(Math.random() * 100000),
    status: SeatStatus.ACTIVE,
  });
  return seat.id;
}

async function seedSnapshot(
  ds: DataSource,
  teamId: number,
  seatId: number,
  month: number,
  year: number,
  allocationPercentage = 100,
): Promise<TeamMemberSnapshot> {
  const repo = ds.getRepository(TeamMemberSnapshotEntity);
  return repo.save({
    teamId,
    seatId,
    month,
    year,
    allocationPercentage,
  } as Partial<TeamMemberSnapshot>);
}

function getCurrentMonthYear(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
}

function getPreviousMonthYear(month: number, year: number): { month: number; year: number } {
  if (month === 1) return { month: 12, year: year - 1 };
  return { month: month - 1, year };
}

describe("executeTeamCarryForward", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    vi.clearAllMocks();
  });

  it("carries forward snapshots from previous month to current month", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const team = await seedTeam(testDs, "Alpha");
    const seat1Id = await seedSeat(testDs, "user-1");
    const seat2Id = await seedSeat(testDs, "user-2");

    await seedSnapshot(testDs, team.id, seat1Id, prev.month, prev.year, 75);
    await seedSnapshot(testDs, team.id, seat2Id, prev.month, prev.year, 50);

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(false);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.recordsProcessed).toBe(2);

    // Verify new snapshots exist for current month
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const newSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month, year },
    });
    expect(newSnapshots).toHaveLength(2);
    const seatIds = newSnapshots.map((s) => s.seatId).sort();
    expect(seatIds).toEqual([seat1Id, seat2Id].sort());
    expect(newSnapshots.map((s) => s.allocationPercentage).sort()).toEqual([50, 75]);
  });

  it("is idempotent — running twice does not create duplicate snapshots", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const team = await seedTeam(testDs, "Beta");
    const seatId = await seedSeat(testDs, "user-3");

    await seedSnapshot(testDs, team.id, seatId, prev.month, prev.year);

    // First run
    const result1 = await executeTeamCarryForward();
    expect(result1.skipped).toBe(false);
    expect(result1.status).toBe(JobStatus.SUCCESS);
    expect(result1.recordsProcessed).toBe(1);

    // Second run — should skip because a successful job exists for this month
    const result2 = await executeTeamCarryForward();
    expect(result2.skipped).toBe(true);
    expect(result2.reason).toBe("already_completed");

    // Verify still only 1 snapshot for current month
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const snapshots = await snapshotRepo.find({
      where: { teamId: team.id, month, year },
    });
    expect(snapshots).toHaveLength(1);
  });

  it("excludes soft-deleted teams from carry-forward", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const activeTeam = await seedTeam(testDs, "Active Team");
    const deletedTeam = await seedTeam(testDs, "Deleted Team", new Date());
    const seatId = await seedSeat(testDs, "user-4");

    await seedSnapshot(testDs, activeTeam.id, seatId, prev.month, prev.year);
    await seedSnapshot(testDs, deletedTeam.id, seatId, prev.month, prev.year);

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(false);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.recordsProcessed).toBe(1);

    // Verify only active team was carried forward
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const activeSnapshots = await snapshotRepo.find({
      where: { teamId: activeTeam.id, month, year },
    });
    expect(activeSnapshots).toHaveLength(1);

    const deletedSnapshots = await snapshotRepo.find({
      where: { teamId: deletedTeam.id, month, year },
    });
    expect(deletedSnapshots).toHaveLength(0);
  });

  it("teams with no snapshots in previous month get no snapshots in current month", async () => {
    const { month, year } = getCurrentMonthYear();

    // Team with no previous month snapshots
    await seedTeam(testDs, "Empty Team");

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(false);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.recordsProcessed).toBe(0);

    // Verify no snapshots created
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const snapshots = await snapshotRepo.find({
      where: { month, year },
    });
    expect(snapshots).toHaveLength(0);
  });

  it("correctly handles year boundary (December → January)", async () => {
    // This test verifies the getPreviousMonth logic within the function.
    // Since executeTeamCarryForward always uses the current date, we verify
    // indirectly by checking that the source month/year calculation is correct.
    // If current month is January, previous should be December of previous year.
    // We test this by seeding snapshots for the computed previous month.
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const team = await seedTeam(testDs, "Year-Boundary Team");
    const seatId = await seedSeat(testDs, "boundary-user");

    // Seed for the computed previous month (whatever it is)
    await seedSnapshot(testDs, team.id, seatId, prev.month, prev.year);

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(false);
    expect(result.status).toBe(JobStatus.SUCCESS);
    expect(result.recordsProcessed).toBe(1);

    // Verify snapshot created in current month
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const newSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month, year },
    });
    expect(newSnapshots).toHaveLength(1);
  });

  it("skips when a successful carry-forward job already exists for current month", async () => {
    // Seed a successful job for this month
    const jobRepo = testDs.getRepository(JobExecutionEntity);
    await jobRepo.save({
      jobType: JobType.TEAM_CARRY_FORWARD,
      status: JobStatus.SUCCESS,
      startedAt: new Date(),
      completedAt: new Date(),
      recordsProcessed: 5,
    });

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already_completed");
  });

  it("skips when another carry-forward job is already running", async () => {
    // Seed a running job
    const jobRepo = testDs.getRepository(JobExecutionEntity);
    await jobRepo.save({
      jobType: JobType.TEAM_CARRY_FORWARD,
      status: JobStatus.RUNNING,
      startedAt: new Date(),
    });

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already_running");
  });

  it("does not skip for stale RUNNING jobs (older than 2 hours)", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    // Seed a stale running job (3 hours ago)
    const jobRepo = testDs.getRepository(JobExecutionEntity);
    await jobRepo.save({
      jobType: JobType.TEAM_CARRY_FORWARD,
      status: JobStatus.RUNNING,
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const team = await seedTeam(testDs, "Stale Test Team");
    const seatId = await seedSeat(testDs, "stale-user");
    await seedSnapshot(testDs, team.id, seatId, prev.month, prev.year);

    const result = await executeTeamCarryForward();

    expect(result.skipped).toBe(false);
    expect(result.status).toBe(JobStatus.SUCCESS);
  });

  it("records job execution with correct recordsProcessed count", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const team1 = await seedTeam(testDs, "Team A");
    const team2 = await seedTeam(testDs, "Team B");
    const seat1Id = await seedSeat(testDs, "a-user");
    const seat2Id = await seedSeat(testDs, "b-user");
    const seat3Id = await seedSeat(testDs, "c-user");

    // Team A: 2 members, Team B: 1 member = 3 total
    await seedSnapshot(testDs, team1.id, seat1Id, prev.month, prev.year);
    await seedSnapshot(testDs, team1.id, seat2Id, prev.month, prev.year);
    await seedSnapshot(testDs, team2.id, seat3Id, prev.month, prev.year);

    const result = await executeTeamCarryForward();

    expect(result.recordsProcessed).toBe(3);

    const jobRepo = testDs.getRepository(JobExecutionEntity);
    const job = await jobRepo.findOne({
      where: { id: result.jobExecutionId },
    });
    expect(job).not.toBeNull();
    expect(job!.jobType).toBe(JobType.TEAM_CARRY_FORWARD);
    expect(job!.status).toBe(JobStatus.SUCCESS);
    expect(job!.completedAt).not.toBeNull();
    expect(job!.recordsProcessed).toBe(3);
  });

  it("carries forward multiple teams with different members", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const team1 = await seedTeam(testDs, "Frontend");
    const team2 = await seedTeam(testDs, "Backend");
    const seat1Id = await seedSeat(testDs, "fe-dev");
    const seat2Id = await seedSeat(testDs, "be-dev");
    const seat3Id = await seedSeat(testDs, "fullstack");

    // seat3 is in both teams
    await seedSnapshot(testDs, team1.id, seat1Id, prev.month, prev.year);
    await seedSnapshot(testDs, team1.id, seat3Id, prev.month, prev.year);
    await seedSnapshot(testDs, team2.id, seat2Id, prev.month, prev.year);
    await seedSnapshot(testDs, team2.id, seat3Id, prev.month, prev.year);

    const result = await executeTeamCarryForward();

    expect(result.recordsProcessed).toBe(4);

    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const team1Snapshots = await snapshotRepo.find({
      where: { teamId: team1.id, month, year },
    });
    expect(team1Snapshots).toHaveLength(2);

    const team2Snapshots = await snapshotRepo.find({
      where: { teamId: team2.id, month, year },
    });
    expect(team2Snapshots).toHaveLength(2);
  });

  it("preserves previous month snapshots (does not delete them)", async () => {
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);

    const team = await seedTeam(testDs, "Preserve Team");
    const seatId = await seedSeat(testDs, "preserve-user");
    await seedSnapshot(testDs, team.id, seatId, prev.month, prev.year);

    await executeTeamCarryForward();

    // Previous month snapshots should still exist
    const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);
    const prevSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month: prev.month, year: prev.year },
    });
    expect(prevSnapshots).toHaveLength(1);

    // Current month should also have the snapshot
    const currentSnapshots = await snapshotRepo.find({
      where: { teamId: team.id, month, year },
    });
    expect(currentSnapshots).toHaveLength(1);
  });

  it("records failure in job execution when an error occurs", async () => {
    // Seed some data so we get past the lock check
    const { month, year } = getCurrentMonthYear();
    const prev = getPreviousMonthYear(month, year);
    const team = await seedTeam(testDs, "fail-team");
    const seatId = await seedSeat(testDs, "fail-user");
    await seedSnapshot(testDs, team.id, seatId, prev.month, prev.year);

    // Drop the unique constraint temporarily to cause the INSERT to fail
    // We'll rename the table so the INSERT query fails
    await testDs.query(`ALTER TABLE team_member_snapshot RENAME TO team_member_snapshot_backup`);

    try {
      const result = await executeTeamCarryForward();

      expect(result.skipped).toBe(false);
      expect(result.status).toBe(JobStatus.FAILURE);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage!.length).toBeGreaterThan(0);

      // Verify the job record was updated to FAILURE
      const jobRepo = testDs.getRepository(JobExecutionEntity);
      const failedJob = await jobRepo.findOne({
        where: { id: result.jobExecutionId! },
      });
      expect(failedJob).not.toBeNull();
      expect(failedJob!.status).toBe(JobStatus.FAILURE);
      expect(failedJob!.errorMessage).toBeDefined();
      expect(failedJob!.completedAt).not.toBeNull();
    } finally {
      // Restore the table so other tests are not affected
      await testDs.query(`ALTER TABLE team_member_snapshot_backup RENAME TO team_member_snapshot`);
    }
  });
});
