/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateUsageCostMetrics,
  type DailyGrossQuantityPoint,
} from "@/lib/usage-cost-metrics";

function buildDailyUsage(days: Array<[number, number]>): DailyGrossQuantityPoint[] {
  return days.map(([day, grossQuantity]) => ({ day, grossQuantity }));
}

describe("calculateUsageCostMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // "Today" is fixed in the middle of March 2025 for historical-month tests below.
    vi.setSystemTime(new Date("2025-03-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses all calendar days for averages of a historical month when usage rows are sparse", () => {
    const result = calculateUsageCostMetrics({
      month: 2,
      year: 2025,
      dailyGrossQuantity: buildDailyUsage([
        [1, 600],
        [15, 1800],
      ]),
    });

    expect(result.month).toBe(2);
    expect(result.year).toBe(2025);
    expect(result.calendarDays).toBe(28);
    expect(result.workingDays).toBe(20);
    expect(result.elapsedDays).toBe(28);
    expect(result.totalCost).toBe(24);
    expect(result.averageDailyCost).toBe(0.86);
    expect(result.predictedMonthCost).toBe(17.2);
  });

  it("returns zero values for empty usage in a leap year month", () => {
    const result = calculateUsageCostMetrics({
      month: 2,
      year: 2024,
      dailyGrossQuantity: [],
    });

    expect(result.calendarDays).toBe(29);
    expect(result.workingDays).toBe(21);
    expect(result.elapsedDays).toBe(29);
    expect(result.totalCost).toBe(0);
    expect(result.averageDailyCost).toBe(0);
    expect(result.predictedMonthCost).toBe(0);
  });

  it("uses the selected month/year context and working-day count for prediction on a historical month", () => {
    const result = calculateUsageCostMetrics({
      month: 2,
      year: 2023,
      dailyGrossQuantity: buildDailyUsage([
        [1, 1000],
        [2, 1000],
        [3, 1000],
      ]),
    });

    expect(result.calendarDays).toBe(28);
    expect(result.workingDays).toBe(20);
    expect(result.elapsedDays).toBe(28);
    expect(result.totalCost).toBe(30);
    expect(result.averageDailyCost).toBe(1.07);
    expect(result.predictedMonthCost).toBe(21.4);
  });

  it("rounds half-up to cents and uses the rounded average for prediction on a historical month", () => {
    const result = calculateUsageCostMetrics({
      month: 1,
      year: 2025,
      dailyGrossQuantity: [{ day: 1, grossQuantity: 3115.5 }],
    });

    expect(result.totalCost).toBe(31.16);
    expect(result.averageDailyCost).toBe(1.01);
    expect(result.predictedMonthCost).toBe(23.23);
  });

  it("divides the average by days elapsed through today for the current month", () => {
    // "Today" is 2025-03-20, so 20 days of March have elapsed (of 31 calendar days).
    const result = calculateUsageCostMetrics({
      month: 3,
      year: 2025,
      dailyGrossQuantity: buildDailyUsage([
        [1, 1000],
        [20, 1000],
      ]),
    });

    expect(result.calendarDays).toBe(31);
    expect(result.elapsedDays).toBe(20);
    expect(result.totalCost).toBe(20);
    expect(result.averageDailyCost).toBe(1);
  });

  it("caps elapsed days at the calendar day count on the last day of the current month", () => {
    vi.setSystemTime(new Date("2025-03-31T23:00:00Z"));

    const result = calculateUsageCostMetrics({
      month: 3,
      year: 2025,
      dailyGrossQuantity: buildDailyUsage([[1, 3100]]),
    });

    expect(result.calendarDays).toBe(31);
    expect(result.elapsedDays).toBe(31);
    expect(result.averageDailyCost).toBe(1);
  });

  it("returns zero elapsed days and a zero average for a future month", () => {
    const result = calculateUsageCostMetrics({
      month: 4,
      year: 2025,
      dailyGrossQuantity: [],
    });

    expect(result.elapsedDays).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.averageDailyCost).toBe(0);
    expect(result.predictedMonthCost).toBe(0);
  });
});
