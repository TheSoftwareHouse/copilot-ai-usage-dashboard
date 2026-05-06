"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { calcUsagePercent, getAllowanceThresholdColor, calcAllowanceTrend } from "@/lib/usage-helpers";
import { UsageStatusIndicator } from "@/components/usage/UsageStatusIndicator";
import DashboardDailyChart from "@/components/dashboard/DashboardDailyChart";
import TelemetryUsageCharts from "@/components/dashboard/TelemetryUsageCharts";
import TopSpendingsChart from "@/components/dashboard/TopSpendingsChart";

interface ModelUsageEntry {
  model: string;
  totalRequests: number;
  totalAmount: number;
}

interface UserActivityEntry {
  seatId?: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  totalRequests: number;
  totalSpending: number;
}

interface TopDailySpendingEntry {
  seatId: number;
  githubUsername: string;
  displayName: string;
  day: number;
  totalSpending: number;
}

interface DashboardData {
  totalSeats: number;
  activeSeats: number;
  modelUsage: ModelUsageEntry[];
  mostActiveUsers: UserActivityEntry[];
  totalSpending: number;
  seatBaseCost: number;
  includedPremiumRequests: number;
  includedPremiumRequestsUsed: number;
  includedPremiumRequestsRemaining: number;
  totalPremiumRequests: number;
  paidPremiumRequests: number;
  premiumRequestsPerSeat: number;
  previousIncludedPremiumRequests: number | null;
  previousIncludedPremiumRequestsUsed: number | null;
  dailyUsage: Array<{ day: number; totalRequests: number }>;
  previousDailyUsage: Array<{ day: number; totalRequests: number }>;
  topDailySpendings: TopDailySpendingEntry[];
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
  const hasAllowance = data.includedPremiumRequests > 0;
  const allowancePercent = hasAllowance
    ? (data.includedPremiumRequestsUsed / data.includedPremiumRequests) * 100
    : 0;
  const { colorClass: allowanceColorClass, label: allowanceLabel } =
    getAllowanceThresholdColor(allowancePercent);
  const hasPreviousData =
    data.previousIncludedPremiumRequests !== null &&
    data.previousIncludedPremiumRequestsUsed !== null &&
    data.previousIncludedPremiumRequests > 0;
  const previousPercent = hasPreviousData
    ? (data.previousIncludedPremiumRequestsUsed! / data.previousIncludedPremiumRequests!) * 100
    : null;
  const trend =
    hasAllowance && previousPercent !== null
      ? calcAllowanceTrend(allowancePercent, previousPercent)
      : null;
  const isEmpty =
    data.totalSeats === 0 &&
    data.modelUsage.length === 0 &&
    data.mostActiveUsers.length === 0;

  const daysInMonth = new Date(data.year, data.month, 0).getDate();

  const handleBarClick = (day: number, clickMonth: number, clickYear: number) => {
    router.push(`/dashboard/daily/${day}?month=${clickMonth}&year=${clickYear}`);
  };

  const handleSpendingBarClick = (seatId: number) => {
    router.push(`/usage/seats/${seatId}?month=${data.month}&year=${data.year}`);
  };

  if (isEmpty) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          No usage data available for {monthLabel}. Data will appear after the
          usage collection job runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Seats Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Total Seats</h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {data.totalSeats}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {data.activeSeats} active · {data.totalSeats - data.activeSeats}{" "}
            inactive
          </p>
        </div>

        {/* Total Spending Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">
            Total Spending
          </h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {formatCurrency(data.totalSpending)}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {formatCurrency(data.totalSpending - data.seatBaseCost)} paid requests + {formatCurrency(data.seatBaseCost)} seat licenses
          </p>
        </div>

        {/* Active Seats Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Active Seats</h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {data.activeSeats}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalSeats > 0
              ? `${Math.round((data.activeSeats / data.totalSeats) * 100)}% of total`
              : "No seats"}
          </p>
        </div>

        {/* Allowance Used Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Allowance Used</h2>
          {hasAllowance ? (
            <p
              className={`mt-2 text-3xl font-bold ${allowanceColorClass}`}
              aria-label={`${Math.round(allowancePercent)}% — ${allowanceLabel}`}
            >
              {Math.round(allowancePercent)}%
            </p>
          ) : (
            <p className="mt-2 text-3xl font-bold text-gray-400" aria-label="Not applicable — no included allowance">N/A</p>
          )}
          <p className="mt-1 text-sm text-gray-500">
            {data.includedPremiumRequestsUsed.toLocaleString()} / {data.includedPremiumRequests.toLocaleString()} requests
          </p>
          {hasAllowance && (
            trend ? (
              <p
                className={`mt-1 text-xs ${trend.colorClass}`}
                aria-label={`${trend.arrow} ${trend.delta}% — ${trend.label}`}
              >
                {trend.arrow} {trend.delta}% vs last month
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">No prior data</p>
            )
          )}
        </div>
      </div>

      {/* Daily Premium Requests Chart */}
      {data.dailyUsage.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Daily Premium Requests
            </h2>
          </div>
          <div className="p-6">
            <DashboardDailyChart
              dailyUsage={data.dailyUsage}
              previousDailyUsage={data.previousDailyUsage}
              daysInMonth={daysInMonth}
              month={data.month}
              year={data.year}
              onBarClick={handleBarClick}
            />
          </div>
        </div>
      )}

      {/* Premium Requests Overview */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Premium Requests
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Included Allowance
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data.includedPremiumRequests.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {data.activeSeats} seats × 300
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Included Used
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data.includedPremiumRequestsUsed.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              Discounted by GitHub
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Included Remaining
            </p>
            <p className="mt-1 text-2xl font-bold text-green-600">
              {data.includedPremiumRequestsRemaining.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Total Used
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data.totalPremiumRequests.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              All requests (uncapped)
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Paid Requests
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {data.paidPremiumRequests.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              Beyond included allowance
            </p>
          </div>
        </div>
      </div>

      {/* Top Daily Spendings */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Top Daily Spendings
          </h2>
        </div>
        <div className="p-6">
          {data.topDailySpendings.length > 0 ? (
            <TopSpendingsChart
              data={data.topDailySpendings}
              month={data.month}
              onBarClick={handleSpendingBarClick}
            />
          ) : (
            <p className="text-sm text-gray-500">No spending data available</p>
          )}
        </div>
      </div>

      {/* Telemetry: Agent & Prompt Usage */}
      <TelemetryUsageCharts month={data.month} year={data.year} />

      {/* Model Usage Breakdown */}
      {data.modelUsage.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Model Usage Breakdown
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-3 font-medium text-gray-500">Model</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">
                    Total Requests
                  </th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">
                    Total Cost
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
            <h2 className="text-lg font-semibold text-gray-900">
              Most Active Users
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {data.mostActiveUsers.map((user) => {
              const name = formatUserName(user);
              const content = (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      <span className="inline-flex items-center gap-2">
                        <UsageStatusIndicator percent={calcUsagePercent(user.totalRequests, data.premiumRequestsPerSeat)} />
                        {user.githubUsername}
                      </span>
                    </p>
                    {name && (
                      <p className="text-xs text-gray-500">
                        {name}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-700">
                      {Math.round(user.totalRequests).toLocaleString()} requests
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatCurrency(user.totalSpending ?? 0)} spent
                    </p>
                  </div>
                </>
              );
              return (
                <li key={user.seatId ?? user.githubUsername}>
                  {user.seatId ? (
                    <Link
                      href={`/usage/seats/${user.seatId}?month=${data.month}&year=${data.year}`}
                      className="flex items-center justify-between px-6 py-3 hover:bg-gray-50"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between px-6 py-3">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
