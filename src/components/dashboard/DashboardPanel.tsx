"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DashboardDailyChart from "@/components/dashboard/DashboardDailyChart";
import UsageCostStatsCards from "@/components/usage/UsageCostStatsCards";
import { getDashboardMetricMode } from "@/lib/aic-reporting";
import type { UsageCostMetrics } from "@/lib/usage-cost-metrics";

interface ModelUsageEntry {
  model: string;
  totalRequests: number;
  totalAmount: number;
}

interface UserActivityEntry {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  totalRequests: number;
  totalSpending: number;
}

interface DashboardData {
  metricMode: ReturnType<typeof getDashboardMetricMode>;
  summaryState: "summary" | "rebuilt" | "pending" | "empty";
  summaryWarnings: string[];
  totalSeats: number;
  activeSeats: number;
  modelUsage: ModelUsageEntry[];
  mostActiveUsers: UserActivityEntry[];
  totalSpending: number;
  seatBaseCost: number;
  totalAiCredits: number;
  dailyUsage: Array<{ day: number; totalRequests: number }>;
  previousDailyUsage: Array<{ day: number; totalRequests: number }>;
  costStats: UsageCostMetrics;
  month: number;
  year: number;
}


interface DashboardPanelProps {
  month: number;
  year: number;
}

import { MONTH_NAMES } from "@/lib/constants";
import { formatCurrency, formatName } from "@/lib/format-helpers";

function formatUserName(user: UserActivityEntry): string {
  return formatName(user.firstName, user.lastName, "");
}

export default function DashboardPanel({ month, year }: DashboardPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/dashboard?month=${month}&year=${year}`,
        );

        if (!response.ok) {
          throw new Error(`Failed to load dashboard data (${response.status})`);
        }

        const json: DashboardData = await response.json();

        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "An unexpected error occurred",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [month, year]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <p className="text-sm text-gray-500">Loading dashboard data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-6"
        role="alert"
      >
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const monthLabel = `${MONTH_NAMES[data.month - 1]} ${data.year}`;
  const chartTitle = "Daily AIC Units";
  const modelBreakdownTitle = "AIC Model Breakdown";
  const isEmpty =
    data.totalSeats === 0 &&
    data.modelUsage.length === 0 &&
    data.mostActiveUsers.length === 0;
  const emptyMessage = `No AIC CSV data has been imported for ${monthLabel} yet. Upload a CSV to populate this dashboard.`;

  const daysInMonth = new Date(data.year, data.month, 0).getDate();

  const handleBarClick = (day: number, clickMonth: number, clickYear: number) => {
    router.push(`/dashboard/daily/${day}?month=${clickMonth}&year=${clickYear}`);
  };

  if (isEmpty) {
    return (
      <div className="space-y-6">
        <UsageCostStatsCards costStats={data.costStats} />
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            {emptyMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.summaryWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="status">
          <p className="text-sm text-amber-800">{data.summaryWarnings[0]}</p>
        </div>
      )}

      <UsageCostStatsCards costStats={data.costStats} />

      {/* Daily AIC Units Chart */}
      {data.dailyUsage.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">{chartTitle}</h2>
          </div>
          <div className="p-6">
            <DashboardDailyChart
              dailyUsage={data.dailyUsage}
              previousDailyUsage={data.previousDailyUsage}
              daysInMonth={daysInMonth}
              month={data.month}
              year={data.year}
              metricLabel="AIC Units"
              onBarClick={handleBarClick}
            />
          </div>
        </div>
      )}

      {/* Model Usage Breakdown */}
      {data.modelUsage.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">{modelBreakdownTitle}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-3 font-medium text-gray-500">Model</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">
                    Total AIC Units
                  </th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">
                    Total AIC Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.modelUsage.map((model) => (
                  <tr
                    key={model.model}
                    className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50"
                    role="link"
                    onClick={() => router.push(`/dashboard/model/${encodeURIComponent(model.model)}?month=${data.month}&year=${data.year}`)}
                  >
                    <td className="px-6 py-3 text-gray-900">{model.model}</td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {model.totalRequests.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {formatCurrency(model.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Most Active Users */}
      {data.mostActiveUsers.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Most Active Users</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {data.mostActiveUsers.map((user) => {
              const name = formatUserName(user);
              const content = (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {user.githubUsername}
                    </p>
                    {name && (
                      <p className="text-xs text-gray-500">
                        {name}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-700">
                      {Math.round(user.totalRequests).toLocaleString()} AIC Units
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatCurrency(user.totalSpending ?? 0)} spent
                    </p>
                  </div>
                </>
              );
              return (
                <li key={user.seatId}>
                  <Link
                    href={`/usage/seats/${user.seatId}?month=${data.month}&year=${data.year}`}
                    className="flex items-center justify-between px-6 py-3 hover:bg-gray-50"
                  >
                    {content}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
