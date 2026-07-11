"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { UsageStatusIndicator } from "@/components/usage/UsageStatusIndicator";
import { formatCurrency } from "@/lib/format-helpers";
import SortableTableHeader from "@/components/shared/SortableTableHeader";
import type { TeamUsageEntry } from "@/components/usage/TeamUsagePanel";
import { isAicReportingMonth } from "@/lib/aic-reporting";

type SortField =
  | "teamName"
  | "memberCount"
  | "totalRequests"
  | "averageRequestsPerMember"
  | "totalGrossAmount"
  | "totalCost"
  | "usagePercent";

interface TeamUsageTableProps {
  teams: TeamUsageEntry[];
  month: number;
  year: number;
}

export default function TeamUsageTable({ teams, month, year }: TeamUsageTableProps) {
  const isAicMode = isAicReportingMonth(month, year);
  const [sortBy, setSortBy] = useState<SortField>(() =>
    isAicMode ? "totalRequests" : "usagePercent",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  function handleSortClick(field: string) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field as SortField);
      setSortOrder("asc");
    }
  }

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "teamName") {
        return dir * a.teamName.localeCompare(b.teamName);
      }
      return dir * (a[sortBy] - b[sortBy]);
    });
  }, [teams, sortBy, sortOrder]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Team usage summary">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <SortableTableHeader label="Team Name" field="teamName" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} />
            <SortableTableHeader label="Members" field="memberCount" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
            <SortableTableHeader label={isAicMode ? "Total AIC Units" : "Total Requests"} field="totalRequests" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
            {!isAicMode && <SortableTableHeader label="Avg Requests/Member" field="averageRequestsPerMember" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />}
            <SortableTableHeader label="Total Spending" field="totalCost" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
            {!isAicMode && <SortableTableHeader label="Usage %" field="usagePercent" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />}
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((team) => (
            <tr
              key={team.teamId}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
            >
              <td className="px-6 py-3 text-gray-900 font-medium">
                <Link
                  href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  <span className="inline-flex items-center gap-2">
                    {!isAicMode && <UsageStatusIndicator percent={team.usagePercent} />}
                    {team.teamName}
                  </span>
                </Link>
              </td>
              <td className="px-6 py-3 text-right text-gray-700">
                <Link
                  href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {team.memberCount}
                </Link>
              </td>
              <td className="px-6 py-3 text-right text-gray-700">
                <Link
                  href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {team.totalRequests.toLocaleString()}
                </Link>
              </td>
              {!isAicMode && (
                <td className="px-6 py-3 text-right text-gray-700">
                  <Link
                    href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                    className="block w-full"
                  >
                    {team.averageRequestsPerMember.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </Link>
                </td>
              )}
              <td className="px-6 py-3 text-right text-gray-700">
                <Link
                  href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {formatCurrency(team.totalCost)}
                </Link>
              </td>
              {!isAicMode && (
                <td className="px-6 py-3 text-right text-gray-700">
                  <Link
                    href={`/usage/teams/${team.teamId}?month=${month}&year=${year}`}
                    className="block w-full"
                  >
                    {Math.round(team.usagePercent)}%
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
