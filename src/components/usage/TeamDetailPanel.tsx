"use client";

import { useState, useEffect } from "react";
import MonthFilter from "@/components/dashboard/MonthFilter";
import TeamDailyChart from "@/components/usage/TeamDailyChart";
import TeamMemberTable from "@/components/usage/TeamMemberTable";
import UsageBreadcrumb from "@/components/usage/UsageBreadcrumb";
import { UsageProgressBar } from "@/components/usage/UsageProgressBar";
import { MONTH_NAMES } from "@/lib/constants";
import { formatCurrency } from "@/lib/format-helpers";
import { useAvailableMonths } from "@/lib/hooks/useAvailableMonths";
import TelemetryUsageCharts from "@/components/dashboard/TelemetryUsageCharts";
import { memberMatchesSearch } from "@/lib/usage-helpers";
import type { MemberEntry } from "@/lib/types";

interface TeamInfo {
  teamId: number;
  teamName: string;
  memberCount: number;
  totalRequests: number;
  totalGrossAmount: number;
  averageRequestsPerMember: number;
  averageGrossAmountPerMember: number;
  usagePercent?: number;
}

interface MemberDailyUsage {
  seatId: number;
  githubUsername: string;
  days: { day: number; totalRequests: number }[];
}

interface TeamDetailResponse {
  team: TeamInfo;
  members: MemberEntry[];
  dailyUsagePerMember: MemberDailyUsage[];
  month: number;
  year: number;
  premiumRequestsPerSeat?: number;
}

interface TeamDetailPanelProps {
  teamId: number;
  initialMonth: number;
  initialYear: number;
}

export default function TeamDetailPanel({
  teamId,
  initialMonth,
  initialYear,
}: TeamDetailPanelProps) {
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<TeamDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { availableMonths, loadingMonths } = useAvailableMonths();

  // Debounce search input → search (300 ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/usage/teams/${teamId}?month=${month}&year=${year}`,
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Team not found");
          }
          throw new Error(
            `Failed to load team usage data (${response.status})`,
          );
        }

        const json: TeamDetailResponse = await response.json();

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
  }, [teamId, month, year]);

  function handleMonthChange(newMonth: number, newYear: number) {
    setMonth(newMonth);
    setYear(newYear);
  }

  const daysInMonth = new Date(year, month, 0).getDate();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <p className="text-sm text-gray-500">Loading team usage data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <UsageBreadcrumb
          section="team"
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

  const { team, members, dailyUsagePerMember } = data;
  const premiumRequestsPerSeat = data.premiumRequestsPerSeat ?? 300;
  const usagePercent = team.usagePercent ?? 0;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const hasMembers = members.length > 0;

  const filteredMembers = search
    ? members.filter((m) => memberMatchesSearch(m, search))
    : members;

  const filteredSeatIds = new Set(filteredMembers.map((m) => m.seatId));
  const filteredDailyUsage = search
    ? dailyUsagePerMember.filter((d) => filteredSeatIds.has(d.seatId))
    : dailyUsagePerMember;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <UsageBreadcrumb
        section="team"
        entityName={team.teamName}
        month={month}
        year={year}
      />

      {/* Usage Progress Bar */}
      <UsageProgressBar percent={usagePercent} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {team.teamName}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
          </p>
        </div>

        <MonthFilter
          availableMonths={availableMonths}
          selectedMonth={month}
          selectedYear={year}
          onChange={handleMonthChange}
          disabled={loadingMonths}
        />
      </div>

      {!hasMembers ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            This team has no members for {monthLabel}.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-medium text-gray-500">
                Total Requests
              </h2>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {team.totalRequests.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-medium text-gray-500">
                Avg Requests/Member
              </h2>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {team.averageRequestsPerMember.toLocaleString(undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-medium text-gray-500">
                Total Spending
              </h2>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {formatCurrency(team.totalGrossAmount)}
              </p>
            </div>
          </div>

          {/* Member Search */}
          <div>
            <label htmlFor="team-member-search" className="sr-only">
              Search members
            </label>
            <input
              id="team-member-search"
              type="search"
              placeholder="Search members…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Daily Usage Chart */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Daily Usage by Member
            </h2>
            <div className="mt-4">
              <TeamDailyChart
                dailyUsagePerMember={filteredDailyUsage}
                daysInMonth={daysInMonth}
              />
            </div>
          </div>

          {/* Member Table */}
          {filteredMembers.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">
                No members match your search query.
              </p>
            </div>
          ) : (
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Members
              </h2>
              <div className="mt-4">
                <TeamMemberTable members={filteredMembers} premiumRequestsPerSeat={premiumRequestsPerSeat} month={month} year={year} />
              </div>
            </div>
          )}

          <TelemetryUsageCharts month={month} year={year} teamId={teamId} />
        </>
      )}
    </div>
  );
}
