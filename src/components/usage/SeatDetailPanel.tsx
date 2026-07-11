"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import MonthFilter from "@/components/dashboard/MonthFilter";
import SeatDailyChart from "@/components/usage/SeatDailyChart";
import SeatModelTable from "@/components/usage/SeatModelTable";
import UsageBreadcrumb from "@/components/usage/UsageBreadcrumb";
import UsageCostStatsCards from "@/components/usage/UsageCostStatsCards";
import { MONTH_NAMES } from "@/lib/constants";
import { formatCurrency, formatName } from "@/lib/format-helpers";
import { useAvailableMonths } from "@/lib/hooks/useAvailableMonths";
import type { UsageCostMetrics } from "@/lib/usage-cost-metrics";

interface SeatInfo {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  departmentId: number | null;
}

interface TeamAssociation {
  teamId: number;
  teamName: string;
  allocationPercentage: number;
  allocatedRequests: number;
  allocatedGrossAmount: number;
}

interface DailyUsageEntry {
  day: number;
  totalRequests: number;
  grossAmount: number;
  deviation?: { level: "none" | "warning" | "alert"; multiplier: number };
}

interface ModelBreakdownEntry {
  model: string;
  totalRequests: number;
  grossAmount: number;
  netAmount: number;
}

interface SummaryData {
  totalRequests: number;
  grossSpending: number;
  netSpending: number;
}

interface SeatDetailResponse {
  seat: SeatInfo;
  summary: SummaryData;
  dailyUsage: DailyUsageEntry[];
  modelBreakdown: ModelBreakdownEntry[];
  teams: TeamAssociation[];
  costStats: UsageCostMetrics;
  month: number;
  year: number;
  normValue: number | null;
}

interface SeatDetailPanelProps {
  seatId: number;
  initialMonth: number;
  initialYear: number;
}

export default function SeatDetailPanel({
  seatId,
  initialMonth,
  initialYear,
}: SeatDetailPanelProps) {
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<SeatDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { availableMonths, loadingMonths } = useAvailableMonths();

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/usage/seats/${seatId}?month=${month}&year=${year}`,
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Seat not found");
          }
          throw new Error(
            `Failed to load seat usage data (${response.status})`,
          );
        }

        const json: SeatDetailResponse = await response.json();

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
  }, [seatId, month, year]);

  function handleMonthChange(newMonth: number, newYear: number) {
    setMonth(newMonth);
    setYear(newYear);
  }

  const daysInMonth = new Date(year, month, 0).getDate();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <p className="text-sm text-gray-500">Loading seat usage data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <UsageBreadcrumb
          section="seat"
          entityName="Error"
          month={month}
          year={year}
        />
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-6"
          role="alert"
        >
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { seat, summary, dailyUsage, modelBreakdown } = data;
  const fullName = formatName(seat.firstName, seat.lastName, "");
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const isEmpty =
    summary.totalRequests === 0 &&
    summary.grossSpending === 0 &&
    summary.netSpending === 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <UsageBreadcrumb
        section="seat"
        entityName={seat.githubUsername}
        month={month}
        year={year}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {seat.githubUsername}
          </h1>
          {fullName && (
            <p className="mt-1 text-sm text-gray-600">{fullName}</p>
          )}
          {seat.departmentId != null && seat.department != null && (
            <p className="mt-1 text-sm text-gray-500">
              Department:{" "}
              <Link
                href={`/usage/departments/${seat.departmentId}?month=${month}&year=${year}`}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                {seat.department}
              </Link>
            </p>
          )}
          {data.teams.length > 0 && (
            <p className="mt-1 text-sm text-gray-500">
              Teams:{" "}
              {data.teams.map((team, index) => (
                <span key={team.teamId}>
                  {index > 0 && ", "}
                  <Link
                    href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {team.teamName}
                  </Link>
                  <span className="ml-1 text-gray-400">({team.allocationPercentage}%)</span>
                  <span className="ml-1 text-gray-400">Usage: {team.allocatedRequests.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  <span className="ml-1 text-gray-400">Spending: {formatCurrency(team.allocatedGrossAmount)}</span>
                </span>
              ))}
            </p>
          )}
        </div>

        <MonthFilter
          availableMonths={availableMonths}
          selectedMonth={month}
          selectedYear={year}
          onChange={handleMonthChange}
          disabled={loadingMonths}
        />
      </div>

      <UsageCostStatsCards costStats={data.costStats} />

      {isEmpty ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            {`No AIC CSV data available for ${seat.githubUsername} in ${monthLabel}.`}
          </p>
        </div>
      ) : (
        <>
          {/* Daily Usage Chart */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Daily AIC Units
            </h2>
            <div className="mt-4">
              <SeatDailyChart
                dailyUsage={dailyUsage}
                daysInMonth={daysInMonth}
                metricLabel="AIC Units"
              />
            </div>
          </div>

          {/* Model Breakdown */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Model Breakdown
            </h2>
            <div className="mt-4">
              <SeatModelTable
                models={modelBreakdown}
                isAicMode={true}
                seatId={seat.seatId}
                month={month}
                year={year}
              />
            </div>
          </div>

        </>
      )}
    </div>
  );
}
