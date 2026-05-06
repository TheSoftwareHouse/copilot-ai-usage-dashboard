"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface ModelEntry {
  model: string;
  totalRequests: number;
  totalSpending: number;
}

interface DailyDetailData {
  users: UserEntry[];
  models: ModelEntry[];
  summary: {
    totalRequests: number;
    totalSpending: number;
    activeUsers: number;
    modelsUsed: number;
  };
  day: number;
  month: number;
  year: number;
}

interface DailyUsageDetailProps {
  day: number;
  month: number;
  year: number;
}

export default function DailyUsageDetail({
  day,
  month,
  year,
}: DailyUsageDetailProps) {
  const router = useRouter();
  const [data, setData] = useState<DailyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("totalRequests");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/dashboard/daily-detail?day=${day}&month=${month}&year=${year}`,
        );
        if (!res.ok) throw new Error("Failed to fetch daily usage data");
        const json: DailyDetailData = await res.json();
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
  }, [day, month, year]);

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
        <p className="text-sm text-gray-500">Loading daily usage data…</p>
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

  const dateLabel = `${MONTH_NAMES[data.month - 1]} ${data.day}, ${data.year}`;

  if (data.summary.totalRequests === 0) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          Daily Usage — {dateLabel}
        </h1>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            No usage data for this day.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        ← Back to Dashboard
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">
        Daily Usage — {dateLabel}
      </h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">
            Total Premium Requests
          </h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {data.summary.totalRequests.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Total Spending</h2>
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Models Used</h2>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {data.summary.modelsUsed}
          </p>
        </div>
      </div>

      {/* Users Table */}
      {sortedUsers.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Users
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <SortableTableHeader
                    label="GitHub Username"
                    field="githubUsername"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
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
                    label="Requests"
                    field="totalRequests"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableTableHeader
                    label="Spending"
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
                    className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50"
                    role="link"
                    onClick={() => router.push(`/usage/seats/${user.seatId}?month=${data.month}&year=${data.year}`)}
                  >
                    <td className="px-6 py-3 text-gray-900">
                      {user.githubUsername}
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

      {/* Model Breakdown Table */}
      {data.models.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Model Breakdown
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium text-gray-500"
                  >
                    Model
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right font-medium text-gray-500"
                  >
                    Requests
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right font-medium text-gray-500"
                  >
                    Spending
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr
                    key={model.model}
                    className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50"
                    role="link"
                    onClick={() => router.push(`/dashboard/model/${encodeURIComponent(model.model)}?month=${data.month}&year=${data.year}&day=${data.day}`)}
                  >
                    <td className="px-6 py-3 text-gray-900">{model.model}</td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {model.totalRequests.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {formatCurrency(model.totalSpending)}
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
