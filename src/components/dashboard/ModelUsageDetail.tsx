"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { MONTH_NAMES } from "@/lib/constants";
import { formatCurrency, formatName } from "@/lib/format-helpers";
import SortableTableHeader from "@/components/shared/SortableTableHeader";

interface UserEntry {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  totalRequests: number;
  totalSpending: number;
}

interface ModelDetailData {
  users: UserEntry[];
  summary: {
    totalRequests: number;
    totalSpending: number;
    activeUsers: number;
  };
  model: string;
  month: number;
  year: number;
  day?: number;
}

interface ModelUsageDetailProps {
  modelName: string;
  month: number;
  year: number;
  day?: number;
}

export default function ModelUsageDetail({
  modelName,
  month,
  year,
  day,
}: ModelUsageDetailProps) {
  const [data, setData] = useState<ModelDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("totalRequests");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!modelName) {
      setLoading(false);
      setError("Model name is required");
      return;
    }

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        let url = `/api/dashboard/model-detail?model=${encodeURIComponent(modelName)}&month=${month}&year=${year}`;
        if (day !== undefined) {
          url += `&day=${day}`;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch model usage data");
        const json: ModelDetailData = await res.json();
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
  }, [modelName, month, year, day]);

  const sortedUsers = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.users].sort((a, b) => {
      const field = sortBy as keyof UserEntry;
      const aVal = a[field];
      const bVal = b[field];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortOrder === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortOrder === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [data, sortBy, sortOrder]);

  function handleSort(field: string) {
    if (field === sortBy) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <p className="text-sm text-gray-500">Loading model usage data…</p>
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

  const headingPrefix = "AIC Model Usage";
  const heading = day !== undefined
    ? `${headingPrefix} — ${modelName} — ${MONTH_NAMES[month - 1]} ${day}, ${year}`
    : `${headingPrefix} — ${modelName} — ${MONTH_NAMES[month - 1]} ${year}`;

  const backHref = day !== undefined
    ? `/dashboard/daily/${day}?month=${month}&year=${year}`
    : "/dashboard";
  const backLabel = day !== undefined ? "Daily AIC Usage" : "Dashboard";
  const summaryRequestsLabel = "Total AIC Units";
  const summarySpendingLabel = "AIC Cost";
  const emptyMessage = "No AIC CSV data for this model and time period.";

  if (data.summary.totalRequests === 0) {
    return (
      <div className="space-y-4">
        <Link
          href={backHref}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← Back to {backLabel}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>
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
      <Link
        href={backHref}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        ← Back to {backLabel}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">{summaryRequestsLabel}</h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {data.summary.totalRequests.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">{summarySpendingLabel}</h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {formatCurrency(data.summary.totalSpending)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Active Users</h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {data.summary.activeUsers}
          </p>
        </div>
      </div>

      {sortedUsers.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium text-gray-500"
                  >
                    GitHub Username
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium text-gray-500"
                  >
                    Display Name
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium text-gray-500"
                  >
                    Department
                  </th>
                  <SortableTableHeader
                    label="AIC Units"
                    field="totalRequests"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableTableHeader
                    label="AIC Cost"
                    field="totalSpending"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((user) => (
                  <tr
                    key={user.seatId}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-6 py-3 text-gray-900">
                      <Link
                        href={`/usage/seats/${user.seatId}/models/${encodeURIComponent(modelName)}?month=${month}&year=${year}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {user.githubUsername}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {formatName(user.firstName, user.lastName)}
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {user.department ?? "—"}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {user.totalRequests.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {formatCurrency(user.totalSpending)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
