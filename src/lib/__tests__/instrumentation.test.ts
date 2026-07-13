/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envBackup = { ...process.env };
const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env = { ...envBackup };
});

afterEach(() => {
  process.env = { ...envBackup };
  globalThis.setTimeout = originalSetTimeout;
  vi.unstubAllGlobals();
});

describe("instrumentation register", () => {
  it("maps SEAT_SYNC_ENABLED and USAGE_COLLECTION_ENABLED env vars to runSyncCycle options", async () => {
    const scheduleMock = vi.fn();

    vi.doMock("node-cron", () => ({
      default: {
        schedule: scheduleMock,
        validate: vi.fn(() => true),
      },
    }));

    const runSyncCycle = vi.fn(async () => ({
      carryForward: null,
      seatSync: null,
      usageCollection: null,
    }));

    vi.doMock("@/lib/sync-cycle", () => ({ runSyncCycle }));
    vi.doMock("@/lib/auth-config", () => ({
      validateAuthConfig: vi.fn(),
      getAuthMethod: vi.fn(() => "credentials"),
    }));

    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SEAT_SYNC_ENABLED = "false";
    process.env.USAGE_COLLECTION_ENABLED = "false";

    const { register } = await import("../../../instrumentation");
    await register();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const scheduledCallback = scheduleMock.mock.calls[0][1] as () => Promise<void>;
    await scheduledCallback();

    expect(runSyncCycle).toHaveBeenCalledTimes(1);
    expect(runSyncCycle).toHaveBeenCalledWith({
      seatSyncEnabled: false,
      usageCollectionEnabled: false,
    });
  });

  it("uses SYNC_CRON_SCHEDULE when valid", async () => {
    const scheduleMock = vi.fn();
    const validateMock = vi.fn((value: string) => value === "*/15 * * * *");

    vi.doMock("node-cron", () => ({
      default: {
        schedule: scheduleMock,
        validate: validateMock,
      },
    }));

    const runSyncCycle = vi.fn(async () => ({
      carryForward: null,
      seatSync: null,
      usageCollection: null,
    }));

    vi.doMock("@/lib/sync-cycle", () => ({ runSyncCycle }));
    vi.doMock("@/lib/auth-config", () => ({
      validateAuthConfig: vi.fn(),
      getAuthMethod: vi.fn(() => "credentials"),
    }));

    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SYNC_CRON_SCHEDULE = "*/15 * * * *";

    const { register } = await import("../../../instrumentation");
    await register();

    expect(validateMock).toHaveBeenCalledWith("*/15 * * * *");
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0]).toBe("*/15 * * * *");
  });

  it("falls back to converted legacy interval when no explicit cron is set", async () => {
    const scheduleMock = vi.fn();

    vi.doMock("node-cron", () => ({
      default: {
        schedule: scheduleMock,
        validate: vi.fn(() => true),
      },
    }));

    vi.doMock("@/lib/sync-cycle", () => ({
      runSyncCycle: vi.fn(async () => ({
        carryForward: null,
        seatSync: null,
        usageCollection: null,
      })),
    }));
    vi.doMock("@/lib/auth-config", () => ({
      validateAuthConfig: vi.fn(),
      getAuthMethod: vi.fn(() => "credentials"),
    }));

    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.SYNC_CRON_SCHEDULE;
    process.env.SEAT_SYNC_INTERVAL_HOURS = "6";

    const { register } = await import("../../../instrumentation");
    await register();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0]).toBe("0 */6 * * *");
  });

  it("runs startup cycle when usage startup flag is true", async () => {
    const scheduleMock = vi.fn();

    vi.doMock("node-cron", () => ({
      default: {
        schedule: scheduleMock,
        validate: vi.fn(() => true),
      },
    }));

    const runSyncCycle = vi.fn(async () => ({
      carryForward: null,
      seatSync: null,
      usageCollection: null,
    }));

    vi.doMock("@/lib/sync-cycle", () => ({ runSyncCycle }));
    vi.doMock("@/lib/auth-config", () => ({
      validateAuthConfig: vi.fn(),
      getAuthMethod: vi.fn(() => "credentials"),
    }));

    const timeoutMock = vi.fn((callback: () => void) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    globalThis.setTimeout = timeoutMock as unknown as typeof setTimeout;

    process.env.NEXT_RUNTIME = "nodejs";
    process.env.USAGE_COLLECTION_RUN_ON_STARTUP = "true";
    process.env.SEAT_SYNC_RUN_ON_STARTUP = "false";

    const { register } = await import("../../../instrumentation");
    await register();

    expect(timeoutMock).toHaveBeenCalledTimes(1);
    expect(runSyncCycle).toHaveBeenCalledTimes(1);
  });
});
