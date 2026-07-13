/// <reference types="vitest/globals" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobStatus } from "@/entities/enums";

const carryForwardCalls: string[] = [];
const seatSyncCalls: string[] = [];
const usageCollectionCalls: string[] = [];

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

vi.mock("@/lib/usage-collection", () => ({
  executeUsageCollection: vi.fn(async () => {
    usageCollectionCalls.push("called");
    return { skipped: false, status: JobStatus.SUCCESS, recordsProcessed: 12 };
  }),
}));

const { runSyncCycle } = await import("@/lib/sync-cycle");

afterEach(() => {
  carryForwardCalls.length = 0;
  seatSyncCalls.length = 0;
  usageCollectionCalls.length = 0;
  vi.clearAllMocks();
});

describe("runSyncCycle", () => {
  it("runs team carry-forward, then seat sync, then usage collection", async () => {
    const result = await runSyncCycle({
      now: new Date("2026-06-04T12:30:00Z"),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(carryForwardCalls).toHaveLength(1);
    expect(seatSyncCalls).toHaveLength(1);
    expect(usageCollectionCalls).toHaveLength(1);
    expect(result.carryForward).toMatchObject({ status: JobStatus.SUCCESS });
    expect(result.seatSync).toMatchObject({ status: JobStatus.SUCCESS });
    expect(result.usageCollection).toMatchObject({ status: JobStatus.SUCCESS });
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
    expect(result.usageCollection).toMatchObject({ status: JobStatus.SUCCESS });
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
    expect(usageCollectionCalls).toHaveLength(1);
    expect(result.carryForward).toMatchObject({ status: JobStatus.SUCCESS });
    expect(result.seatSync).toBeNull();
    expect(result.usageCollection).toMatchObject({ status: JobStatus.SUCCESS });
  });

  it("skips usage collection when seat sync is skipped", async () => {
    const executeSeatSync = vi.fn(async () => ({
      skipped: true,
      reason: "no_configuration",
      status: JobStatus.NO_OP,
    }));
    const executeUsageCollection = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.SUCCESS,
      recordsProcessed: 5,
    }));

    const result = await runSyncCycle({
      executeSeatSync,
      executeUsageCollection,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(executeSeatSync).toHaveBeenCalledTimes(1);
    expect(executeUsageCollection).not.toHaveBeenCalled();
    expect(result.seatSync).toMatchObject({ skipped: true });
    expect(result.usageCollection).toBeNull();
  });

  it("skips usage collection when seat sync fails", async () => {
    const executeSeatSync = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.FAILURE,
    }));
    const executeUsageCollection = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.SUCCESS,
      recordsProcessed: 5,
    }));

    const result = await runSyncCycle({
      executeSeatSync,
      executeUsageCollection,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(executeSeatSync).toHaveBeenCalledTimes(1);
    expect(executeUsageCollection).not.toHaveBeenCalled();
    expect(result.seatSync).toMatchObject({ status: JobStatus.FAILURE });
    expect(result.usageCollection).toBeNull();
  });

  it("skips usage collection when seat sync throws", async () => {
    const executeSeatSync = vi.fn(async () => {
      throw new Error("seat sync exploded");
    });
    const executeUsageCollection = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.SUCCESS,
      recordsProcessed: 5,
    }));

    const result = await runSyncCycle({
      executeSeatSync,
      executeUsageCollection,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(executeSeatSync).toHaveBeenCalledTimes(1);
    expect(executeUsageCollection).not.toHaveBeenCalled();
    expect(result.seatSync).toBeNull();
    expect(result.usageCollection).toBeNull();
  });

  it("skips usage collection when disabled", async () => {
    const executeUsageCollection = vi.fn(async () => ({
      skipped: false,
      status: JobStatus.SUCCESS,
      recordsProcessed: 5,
    }));

    const result = await runSyncCycle({
      usageCollectionEnabled: false,
      executeUsageCollection,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(seatSyncCalls).toHaveLength(1);
    expect(executeUsageCollection).not.toHaveBeenCalled();
    expect(result.usageCollection).toBeNull();
  });
});
