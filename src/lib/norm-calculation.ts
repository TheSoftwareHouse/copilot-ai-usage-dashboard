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
 * Calculate the usage norm for the given month/year based on the top N
 * most active seats from the previous calendar month.
 *
 * Reads `normSeatsCount`, `deviationWarningThreshold`, and
 * `deviationAlertThreshold` from the Configuration entity.
 *
 * Formula: sumOfTopNTotals / actualN / daysInPreviousMonth
 */
export async function calculateNorm(
  month: number,
  year: number,
): Promise<NormResult> {
  const dataSource = await getDb();
  const configRepo = dataSource.getRepository(ConfigurationEntity);
  const config = await configRepo.findOne({ where: {} });

  const normSeatsCount = config?.normSeatsCount ?? 30;
  const warningThreshold = config != null
    ? Number(config.deviationWarningThreshold)
    : 1.5;
  const alertThreshold = config != null
    ? Number(config.deviationAlertThreshold)
    : 2.0;

  // Compute previous month
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = year - 1;
  }

  const daysInPreviousMonth = new Date(prevYear, prevMonth, 0).getDate();

  const topSeats: { seatId: number; totalRequests: string }[] =
    await dataSource.query(
      `SELECT cu."seatId",
              SUM((item->>'grossQuantity')::numeric) AS "totalRequests"
       FROM copilot_usage cu,
            jsonb_array_elements(cu."usageItems") AS item
       WHERE cu."month" = $1 AND cu."year" = $2
       GROUP BY cu."seatId"
       HAVING SUM((item->>'grossQuantity')::numeric) > 0
       ORDER BY "totalRequests" DESC
       LIMIT $3`,
      [prevMonth, prevYear, normSeatsCount],
    );

  if (topSeats.length === 0) {
    return { normValue: null, warningThreshold, alertThreshold };
  }

  const sumOfTopN = topSeats.reduce(
    (sum, row) => sum + Number(row.totalRequests),
    0,
  );
  const actualN = topSeats.length;
  const normValue = sumOfTopN / actualN / daysInPreviousMonth;

  return { normValue, warningThreshold, alertThreshold };
}

/**
 * Pure function that classifies a single day's usage against the norm.
 *
 * Returns `"none"` when normValue is null or dayUsage is 0.
 * Otherwise computes multiplier = dayUsage / normValue and classifies
 * by the warning and alert thresholds.
 */
export function calculateDeviation(
  dayUsage: number,
  normValue: number | null,
  warningThreshold: number,
  alertThreshold: number,
): DeviationResult {
  if (normValue === null || dayUsage === 0) {
    return { level: "none", multiplier: 0 };
  }

  const multiplier = dayUsage / normValue;

  if (multiplier >= alertThreshold) {
    return { level: "alert", multiplier };
  }
  if (multiplier >= warningThreshold) {
    return { level: "warning", multiplier };
  }
  return { level: "none", multiplier };
}

/**
 * Pure function that classifies a seat's peak daily usage against the norm.
 *
 * Returns `"none"` with null peaks when peakDailyRequests or normValue is null.
 */
export function calculateSeatDeviation(
  peakDailyRequests: number | null,
  peakDay: number | null,
  normValue: number | null,
  warningThreshold: number,
  alertThreshold: number,
): SeatDeviationResult {
  if (peakDailyRequests === null || normValue === null) {
    return { deviationLevel: "none", peakMultiplier: null, peakDay: null };
  }

  const peakMultiplier = peakDailyRequests / normValue;

  if (peakMultiplier >= alertThreshold) {
    return { deviationLevel: "alert", peakMultiplier, peakDay };
  }
  if (peakMultiplier >= warningThreshold) {
    return { deviationLevel: "warning", peakMultiplier, peakDay };
  }
  return { deviationLevel: "none", peakMultiplier, peakDay };
}
