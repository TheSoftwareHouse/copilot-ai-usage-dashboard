"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { UsageStatusIndicator } from "@/components/usage/UsageStatusIndicator";
import SortableTableHeader from "@/components/shared/SortableTableHeader";
import type { DepartmentUsageEntry } from "@/components/usage/DepartmentUsagePanel";
import { formatCurrency } from "@/lib/format-helpers";
import { isAicReportingMonth } from "@/lib/aic-reporting";

type SortField =
  | "departmentName"
  | "totalRequests"
  | "totalGrossAmount"
  | "averageRequestsPerMember"
  | "usagePercent";

interface DepartmentUsageTableProps {
  departments: DepartmentUsageEntry[];
  month: number;
  year: number;
}

export default function DepartmentUsageTable({
  departments,
  month,
  year,
}: DepartmentUsageTableProps) {
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

  const sortedDepartments = useMemo(() => {
    return [...departments].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "departmentName") {
        return dir * a.departmentName.localeCompare(b.departmentName);
      }
      return dir * (a[sortBy] - b[sortBy]);
    });
  }, [departments, sortBy, sortOrder]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Department usage summary">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <SortableTableHeader label="Department Name" field="departmentName" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} />
            {isAicMode ? (
              <>
                <SortableTableHeader label="Total AIC Units" field="totalRequests" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
                <SortableTableHeader label="Total Spending" field="totalGrossAmount" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
              </>
            ) : (
              <>
                <SortableTableHeader label="Avg Requests/Member" field="averageRequestsPerMember" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
                <SortableTableHeader label="Usage %" field="usagePercent" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedDepartments.map((dept) => (
            <tr
              key={dept.departmentId}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
            >
              <td className="px-6 py-3 text-gray-900 font-medium">
                <Link
                  href={`/usage/departments/${dept.departmentId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  <span className="inline-flex items-center gap-2">
                    {!isAicMode && <UsageStatusIndicator percent={dept.usagePercent} />}
                    {dept.departmentName}
                  </span>
                </Link>
              </td>
              {isAicMode ? (
                <>
                  <td className="px-6 py-3 text-right text-gray-700">
                    <Link
                      href={`/usage/departments/${dept.departmentId}?month=${month}&year=${year}`}
                      className="block w-full"
                    >
                      {dept.totalRequests.toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-right text-gray-700">
                    <Link
                      href={`/usage/departments/${dept.departmentId}?month=${month}&year=${year}`}
                      className="block w-full"
                    >
                      {formatCurrency(dept.totalGrossAmount)}
                    </Link>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-6 py-3 text-right text-gray-700">
                    <Link
                      href={`/usage/departments/${dept.departmentId}?month=${month}&year=${year}`}
                      className="block w-full"
                    >
                      {dept.averageRequestsPerMember.toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-right text-gray-700">
                    <Link
                      href={`/usage/departments/${dept.departmentId}?month=${month}&year=${year}`}
                      className="block w-full"
                    >
                      {Math.round(dept.usagePercent)}%
                    </Link>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
