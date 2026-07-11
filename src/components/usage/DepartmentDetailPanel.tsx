"use client";

import { useState, useEffect } from "react";
import MonthFilter from "@/components/dashboard/MonthFilter";
import TeamDailyChart from "@/components/usage/TeamDailyChart";
import TeamMemberTable from "@/components/usage/TeamMemberTable";
import UsageBreadcrumb from "@/components/usage/UsageBreadcrumb";
import UsageCostStatsCards from "@/components/usage/UsageCostStatsCards";
import DepartmentDetailStatsCards from "@/components/usage/DepartmentDetailStatsCards";
import { useAvailableMonths } from "@/lib/hooks/useAvailableMonths";
import { memberMatchesSearch } from "@/lib/usage-helpers";
import { isAicReportingMonth } from "@/lib/aic-reporting";
import type { MemberEntry } from "@/lib/types";
import type { UsageCostMetrics } from "@/lib/usage-cost-metrics";

const DEPARTMENT_CHART_ACCESSIBLE_LABEL =
  "Daily AIC Units line chart for each department member";

interface DepartmentInfo {
  departmentId: number;
  departmentName: string;
  memberCount: number;
  totalRequests: number;
  totalGrossAmount: number;
  averageRequestsPerMember: number;
}

interface MemberDailyUsage {
  seatId: number;
  githubUsername: string;
  days: { day: number; totalRequests: number }[];
}

interface DepartmentDetailResponse {
  department: DepartmentInfo;
  members: MemberEntry[];
  dailyUsagePerMember: MemberDailyUsage[];
  costStats: UsageCostMetrics;
  month: number;
  year: number;
}

interface DepartmentDetailPanelProps {
  departmentId: number;
  initialMonth: number;
  initialYear: number;
}

export default function DepartmentDetailPanel({
  departmentId,
  initialMonth,
  initialYear,
}: DepartmentDetailPanelProps) {
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<DepartmentDetailResponse | null>(null);
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
          `/api/usage/departments/${departmentId}?month=${month}&year=${year}`,
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Department not found");
          }
          throw new Error(
            `Failed to load department usage data (${response.status})`,
          );
        }

        const json: DepartmentDetailResponse = await response.json();

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
  }, [departmentId, month, year]);

  function handleMonthChange(newMonth: number, newYear: number) {
    setMonth(newMonth);
    setYear(newYear);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <DepartmentDetailStatsCards departmentId={departmentId} month={month} year={year} />
        <div className="flex items-center justify-center py-12" role="status">
          <p className="text-sm text-gray-500">
            Loading department usage data…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <UsageBreadcrumb
          section="department"
          entityName="Error"
          month={month}
          year={year}
        />
        <DepartmentDetailStatsCards departmentId={departmentId} month={month} year={year} />
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-6"
          role="alert"
        >
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { department, members, dailyUsagePerMember } = data;
  const hasMembers = members.length > 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  const isAicMode = isAicReportingMonth(month, year);

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
        section="department"
        entityName={department.departmentName}
        month={month}
        year={year}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {department.departmentName}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {department.memberCount}{" "}
            {department.memberCount === 1 ? "member" : "members"}
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

      {!isAicMode && <DepartmentDetailStatsCards departmentId={departmentId} month={month} year={year} />}

      <UsageCostStatsCards costStats={data.costStats} />

      {!hasMembers ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            This department has no assigned seats.
          </p>
        </div>
      ) : (
        <>
          {/* Member Search */}
          <div>
            <label htmlFor="department-member-search" className="sr-only">
              Search members
            </label>
            <input
              id="department-member-search"
              type="search"
              placeholder="Search members…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              {isAicMode ? "Daily AIC Units by Member" : "Daily Usage by Member"}
            </h2>
            <div className="mt-4">
              <TeamDailyChart
                dailyUsagePerMember={filteredDailyUsage}
                daysInMonth={daysInMonth}
                metricLabel={isAicMode ? "AIC Units" : "Total Requests"}
                accessibleLabel={DEPARTMENT_CHART_ACCESSIBLE_LABEL}
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
              <h2 className="text-lg font-semibold text-gray-900">Members</h2>
              <div className="mt-4">
                <TeamMemberTable members={filteredMembers} month={month} year={year} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
