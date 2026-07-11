import {
  executeSeatSync,
  type SeatSyncResult,
} from "@/lib/seat-sync";
import {
  executeTeamCarryForward,
  type TeamCarryForwardResult,
} from "@/lib/team-carry-forward";

export interface RunSyncCycleOptions {
  now?: Date;
  seatSyncEnabled?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
  executeTeamCarryForward?: () => Promise<TeamCarryForwardResult>;
  executeSeatSync?: () => Promise<SeatSyncResult>;
}

export interface RunSyncCycleResult {
  carryForward: TeamCarryForwardResult | null;
  seatSync: SeatSyncResult | null;
}

export async function runSyncCycle(
  options: RunSyncCycleOptions = {},
): Promise<RunSyncCycleResult> {
  const logger = options.logger ?? console;
  void options.now;
  const seatSyncEnabled = options.seatSyncEnabled ?? true;
  const runTeamCarryForward = options.executeTeamCarryForward ?? executeTeamCarryForward;
  const runSeatSync = options.executeSeatSync ?? executeSeatSync;

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

  return {
    carryForward: carryForwardResult,
    seatSync: seatSyncResult,
  };
}