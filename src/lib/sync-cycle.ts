import {
  executeSeatSync,
  type SeatSyncResult,
} from "@/lib/seat-sync";
import {
  executeTeamCarryForward,
  type TeamCarryForwardResult,
} from "@/lib/team-carry-forward";
import {
  executeUsageCollection,
  type UsageCollectionResult,
} from "@/lib/usage-collection";
import { JobStatus, JobType } from "@/entities/enums";

export interface RunSyncCycleOptions {
  now?: Date;
  seatSyncEnabled?: boolean;
  usageCollectionEnabled?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
  executeTeamCarryForward?: () => Promise<TeamCarryForwardResult>;
  executeSeatSync?: () => Promise<SeatSyncResult>;
  executeUsageCollection?: () => Promise<UsageCollectionResult>;
}

export interface RunSyncCycleResult {
  carryForward: TeamCarryForwardResult | null;
  seatSync: SeatSyncResult | null;
  usageCollection: UsageCollectionResult | null;
}

export async function runSyncCycle(
  options: RunSyncCycleOptions = {},
): Promise<RunSyncCycleResult> {
  const logger = options.logger ?? console;
  void options.now;
  const seatSyncEnabled = options.seatSyncEnabled ?? true;
  const usageCollectionEnabled = options.usageCollectionEnabled ?? true;
  const runTeamCarryForward = options.executeTeamCarryForward ?? executeTeamCarryForward;
  const runSeatSync = options.executeSeatSync ?? executeSeatSync;
  const runUsageCollection =
    options.executeUsageCollection ??
    (() => executeUsageCollection({ jobType: JobType.USAGE_COLLECTION }));

  logger.log("Starting scheduled sync cycle");

  let carryForwardResult: TeamCarryForwardResult | null = null;
  try {
    carryForwardResult = await runTeamCarryForward();
    if (carryForwardResult.skipped) {
      logger.log(`Team carry-forward skipped: ${carryForwardResult.reason}`);
    }
  } catch (error) {
    logger.error("Scheduled team carry-forward failed:", error);
  }

  let seatSyncResult: SeatSyncResult | null = null;
  if (seatSyncEnabled) {
    try {
      seatSyncResult = await runSeatSync();
      if (seatSyncResult.skipped) {
        logger.log(`Seat sync skipped: ${seatSyncResult.reason}`);
      }
    } catch (error) {
      logger.error("Scheduled seat sync failed:", error);
    }
  } else {
    logger.log("Seat sync skipped: disabled");
  }

  let usageCollectionResult: UsageCollectionResult | null = null;
  if (usageCollectionEnabled) {
    const canRunUsageCollection =
      !seatSyncEnabled ||
      (seatSyncResult !== null &&
        !seatSyncResult.skipped &&
        seatSyncResult.status === JobStatus.SUCCESS);

    if (canRunUsageCollection) {
      try {
        usageCollectionResult = await runUsageCollection();
        if (usageCollectionResult.skipped) {
          logger.log(`Usage collection skipped: ${usageCollectionResult.reason}`);
        }
      } catch (error) {
        logger.error("Scheduled usage collection failed:", error);
      }
    } else {
      logger.log("Usage collection skipped: seat sync did not succeed");
    }
  } else {
    logger.log("Usage collection skipped: disabled");
  }

  return {
    carryForward: carryForwardResult,
    seatSync: seatSyncResult,
    usageCollection: usageCollectionResult,
  };
}
