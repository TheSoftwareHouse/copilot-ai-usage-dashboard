import { getDb } from "@/lib/db";
import { ConfigurationEntity } from "@/entities/configuration.entity";

export interface NormResult {
  normValue: number | null;
  warningThreshold: number;
  alertThreshold: number;
}

export interface DeviationResult {
  level: "none" | "warning" | "alert";
  multiplier: number;
}

export interface SeatDeviationResult {
  deviationLevel: "none" | "warning" | "alert";
  peakMultiplier: number | null;
  peakDay: number | null;
}

/**
 * Read the configured absolute AIC-unit thresholds.
 *
 * The legacy norm-based calculation is intentionally disabled.
 */
export async function calculateNorm(
  month: number,
  year: number,
): Promise<NormResult> {
  void month;
  void year;

  const dataSource = await getDb();
  const configRepo = dataSource.getRepository(ConfigurationEntity);
  const config = await configRepo.findOne({ where: {} });

  const warningThreshold = config != null
    ? Number(config.deviationWarningThreshold)
    : 500;
  const alertThreshold = config != null
    ? Number(config.deviationAlertThreshold)
    : 1000;

  return { normValue: null, warningThreshold, alertThreshold };
}

/**
 * Pure function that classifies a single day's usage against static
 * AIC-unit thresholds.
 */
export function calculateDeviation(
  dayUsage: number,
  _normValue: number | null,
  warningThreshold: number,
  alertThreshold: number,
): DeviationResult {
  if (dayUsage === 0) {
    return { level: "none", multiplier: 0 };
  }

  const multiplier = dayUsage;

  if (multiplier >= alertThreshold) {
    return { level: "alert", multiplier };
  }
  if (multiplier >= warningThreshold) {
    return { level: "warning", multiplier };
  }
  return { level: "none", multiplier };
}

/**
 * Pure function that classifies a seat's peak daily usage against static
 * AIC-unit thresholds.
 */
export function calculateSeatDeviation(
  peakDailyRequests: number | null,
  peakDay: number | null,
  _normValue: number | null,
  warningThreshold: number,
  alertThreshold: number,
): SeatDeviationResult {
  if (peakDailyRequests === null) {
    return { deviationLevel: "none", peakMultiplier: null, peakDay: null };
  }

  const peakMultiplier = peakDailyRequests;

  if (peakMultiplier >= alertThreshold) {
    return { deviationLevel: "alert", peakMultiplier, peakDay };
  }
  if (peakMultiplier >= warningThreshold) {
    return { deviationLevel: "warning", peakMultiplier, peakDay };
  }
  return { deviationLevel: "none", peakMultiplier, peakDay };
}
