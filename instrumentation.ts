import cron from "node-cron";

/**
 * Default: daily at midnight UTC.
 * Override with SYNC_CRON_SCHEDULE (any valid cron expression)
 * or the legacy SYNC_INTERVAL_HOURS / SEAT_SYNC_INTERVAL_HOURS env vars.
 */
const DEFAULT_CRON = "0 0 * * *";

/**
 * Convert a whole-number hours value to a cron expression.
 * Examples: 24 → "0 0 * * *", 6 → "0 *​/6 * * *", 1 → "0 * * * *"
 */
function hoursToCron(hours: number): string | null {
  if (!Number.isInteger(hours) || hours <= 0 || hours > 24) return null;
  if (hours === 24) return "0 0 * * *";
  return `0 */${hours} * * *`;
}

function resolveCronSchedule(): string {
  // Prefer explicit cron expression
  const explicit = process.env.SYNC_CRON_SCHEDULE;
  if (explicit) {
    if (!cron.validate(explicit)) {
      console.error(`Invalid SYNC_CRON_SCHEDULE: "${explicit}". Falling back to default.`);
      return DEFAULT_CRON;
    }
    return explicit;
  }

  // Legacy: convert SYNC_INTERVAL_HOURS / SEAT_SYNC_INTERVAL_HOURS to cron
  const legacyRaw =
    process.env.SYNC_INTERVAL_HOURS || process.env.SEAT_SYNC_INTERVAL_HOURS;
  if (legacyRaw) {
    const hours = parseFloat(legacyRaw);
    const converted = hoursToCron(hours);
    if (converted) return converted;
    console.warn(
      `Cannot convert SYNC_INTERVAL_HOURS="${legacyRaw}" to cron. ` +
        `Use SYNC_CRON_SCHEDULE instead. Falling back to default.`,
    );
  }

  return DEFAULT_CRON;
}

export async function register() {
  console.log("Registering instrumentation...");
  console.log(`Runtime: ${process.env.NEXT_RUNTIME || "undefined"}`);
  console.log(`Schedule: ${process.env.SYNC_CRON_SCHEDULE || "not set"}`);
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { runSyncCycle } = await import("@/lib/sync-cycle");

  // Validate auth configuration early — fail fast on invalid config
  const { validateAuthConfig, getAuthMethod } = await import(
    "@/lib/auth-config"
  );
  validateAuthConfig();
  console.log(`Authentication method: ${getAuthMethod()}`);

  // Warn early if ENCRYPTION_KEY is missing — the app can start without it
  // (e.g. during migration period), but GitHub App credential storage will fail.
  if (!process.env.ENCRYPTION_KEY) {
    console.warn(
      "⚠ ENCRYPTION_KEY is not set. GitHub App credential storage will not work.",
    );
  }

  const schedule = resolveCronSchedule();
  const runScheduledSyncCycle = () =>
    runSyncCycle({
      seatSyncEnabled: process.env.SEAT_SYNC_ENABLED !== "false",
    }).catch((error) => {
      console.error("Scheduled sync cycle failed:", error);
    });

  console.log(`Sync scheduler starting (cron: "${schedule}")`);
  cron.schedule(schedule, runScheduledSyncCycle, { timezone: "UTC" });

  // Startup sync triggers the carry-forward -> seat-sync cycle.
  const runOnStartup = process.env.SEAT_SYNC_RUN_ON_STARTUP === "true";

  if (runOnStartup) {
    console.log("Sync on startup enabled — scheduling initial cycle in 10s");
    setTimeout(() => {
      runScheduledSyncCycle();
    }, 10_000);
  }
}
