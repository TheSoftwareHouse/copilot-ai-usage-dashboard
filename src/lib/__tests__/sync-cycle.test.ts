/// <reference types="vitest/globals" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobStatus } from "@/entities/enums";

const carryForwardCalls: string[] = [];
const seatSyncCalls: string[] = [];

vi.mock("@/lib/team-carry-forward", () => ({
  executeTeamCarryForward: vi.fn(async () => {
    carryForwardCalls.push("called");
    return { skipped: false, status: JobStatus.SUCCESS, recordsProcessed: 1 };
  }),
}));

vi.mock("@/lib/seat-sync", () => ({
  executeSeatSync: vi.fn(async () => {
    seatSyncCalls.push("called");
    return { skipped: false, status: JobStatus.SUCCESS, recordsProcessed: 10 };
  }),
}));

const { runSyncCycle } = await import("@/lib/sync-cycle");

afterEach(() => {
  carryForwardCalls.length = 0;
  seatSyncCalls.length = 0;
  vi.clearAllMocks();
});

describe("runSyncCycle", () => {
  it("runs team carry-forward, then seat sync", async () => {
    const result = await runSyncCycle({
      now: new Date("2026-06-04T12:30:00Z"),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(carryForwardCalls).toHaveLength(1);
    expect(seatSyncCalls).toHaveLength(1);
    expect(result.carryForward).toMatchObject({ status: JobStatus.SUCCESS });
    expect(result.seatSync).toMatchObject({ status: JobStatus.SUCCESS });
  });

  it("still runs seat sync when carry-forward fails", async () => {
    const executeTeamCarryForward = vi.fn(async () => {
      throw new Error("carry-forward exploded");
    });

    const executeSeatSync = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.SUCCESS,
      recordsProcessed: 5,
    }));

    const result = await runSyncCycle({
      executeTeamCarryForward,
      executeSeatSync,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(executeTeamCarryForward).toHaveBeenCalledTimes(1);
    expect(executeSeatSync).toHaveBeenCalledTimes(1);
    expect(result.carryForward).toBeNull();
    expect(result.seatSync).toMatchObject({ status: JobStatus.SUCCESS });
  });

  it("skips seat sync when disabled", async () => {
    const executeSeatSync = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.SUCCESS,
      recordsProcessed: 5,
    }));

    const result = await runSyncCycle({
      seatSyncEnabled: false,
      executeSeatSync,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(carryForwardCalls).toHaveLength(1);
    expect(executeSeatSync).not.toHaveBeenCalled();
    expect(result.carryForward).toMatchObject({ status: JobStatus.SUCCESS });
    expect(result.seatSync).toBeNull();
  });
});
