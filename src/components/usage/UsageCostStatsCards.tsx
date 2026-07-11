"use client";

import { formatCurrency } from "@/lib/format-helpers";
import type { UsageCostMetrics } from "@/lib/usage-cost-metrics";

interface UsageCostStatsCardsProps {
  costStats: UsageCostMetrics;
}

export default function UsageCostStatsCards({ costStats }: UsageCostStatsCardsProps) {
  const { averageDailyCost, totalCost, predictedMonthCost, elapsedDays, workingDays } = costStats;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-gray-500">Average Daily Cost</h2>
        <p className="mt-2 text-3xl font-bold text-gray-900">
          {formatCurrency(averageDailyCost)}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Across {elapsedDays} elapsed {elapsedDays === 1 ? "day" : "days"}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-gray-500">Total Cost</h2>
        <p className="mt-2 text-3xl font-bold text-gray-900">
          {formatCurrency(totalCost)}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-gray-500">Predicted Month Cost</h2>
        <p className="mt-2 text-3xl font-bold text-gray-900">
          {formatCurrency(predictedMonthCost)}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Based on {workingDays} working {workingDays === 1 ? "day" : "days"}
        </p>
      </div>
    </div>
  );
}
