export interface DailyGrossQuantityPoint {
  day: number;
  grossQuantity: number;
}

export interface UsageCostMetricsInput {
  month: number;
  year: number;
  dailyGrossQuantity: DailyGrossQuantityPoint[];
}

export interface UsageCostMetrics {
  month: number;
  year: number;
  calendarDays: number;
  workingDays: number;
  elapsedDays: number;
  totalCost: number;
  averageDailyCost: number;
  predictedMonthCost: number;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function countWorkingDays(month: number, year: number): number {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  let count = 0;

  for (let date = firstDay; date <= lastDay; date = new Date(date.getTime() + 24 * 60 * 60 * 1000)) {
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      count += 1;
    }
  }

  return count;
}

/**
 * Number of days in the selected month that have actually elapsed, counted
 * through today (inclusive).
 *
 * - Historical month (before the current calendar month): the whole month
 *   has elapsed, so this equals `calendarDays`.
 * - Current calendar month: elapsed days is today's day-of-month, capped at
 *   `calendarDays`.
 * - Future month: nothing has elapsed yet, so this is 0.
 */
function countElapsedDays(month: number, year: number, calendarDays: number): number {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return calendarDays;
  }

  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return 0;
  }

  return Math.min(now.getUTCDate(), calendarDays);
}

export function calculateUsageCostMetrics({
  month,
  year,
  dailyGrossQuantity,
}: UsageCostMetricsInput): UsageCostMetrics {
  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const workingDays = countWorkingDays(month, year);
  const elapsedDays = countElapsedDays(month, year, calendarDays);

  const totalGrossQuantity = dailyGrossQuantity.reduce((sum, entry) => {
    if (entry.day < 1 || entry.day > calendarDays) {
      return sum;
    }

    return sum + Number(entry.grossQuantity ?? 0);
  }, 0);

  const totalCost = roundToCents(totalGrossQuantity / 100);
  const averageDailyCost = elapsedDays > 0 ? roundToCents(totalCost / elapsedDays) : 0;
  const predictedMonthCost = roundToCents(averageDailyCost * workingDays);

  return {
    month,
    year,
    calendarDays,
    workingDays,
    elapsedDays,
    totalCost,
    averageDailyCost,
    predictedMonthCost,
  };
}
