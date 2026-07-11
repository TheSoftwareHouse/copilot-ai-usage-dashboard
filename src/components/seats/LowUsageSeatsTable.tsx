"use client";

import { useState, useEffect } from "react";
import SortableTableHeader from "@/components/shared/SortableTableHeader";
import Pagination from "@/components/usage/Pagination";
import { UsageStatusIndicator } from "@/components/usage/UsageStatusIndicator";
import { formatName } from "@/lib/format-helpers";

interface LowUsageSeat {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  totalRequests: number;
  usagePercent: number;
}

interface LowUsageSeatsResponse {
  seats: LowUsageSeat[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 10;

export default function LowUsageSeatsTable() {
  const [data, setData] = useState<LowUsageSeatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("usagePercent");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
          sortBy,
          sortOrder,
        });
        const res = await fetch(`/api/seats/low-usage?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch low usage seats");
        const json: LowUsageSeatsResponse = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [page, sortBy, sortOrder]);

  function handleSortClick(field: string) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
    setPage(1);
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Low Usage Seats — This Month
        </h2>
        <div className="flex items-center justify-center py-12" role="status">
          <p className="text-sm text-gray-500">Loading low usage seats…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Low Usage Seats — This Month
        </h2>
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-6"
          role="alert"
        >
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Low Usage Seats — This Month
        </h2>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            All seats are at 100% usage or above this month.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Low Usage Seats — This Month
      </h2>
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <SortableTableHeader
                label="GitHub Username"
                field="githubUsername"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSortClick}
              />
              <th className="px-6 py-3 font-medium text-gray-500">
                Display Name
              </th>
              <SortableTableHeader
                label="Department"
                field="department"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSortClick}
              />
              <SortableTableHeader
                label="Usage %"
                field="usagePercent"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSortClick}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {data.seats.map((seat) => (
              <tr
                key={seat.seatId}
                className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
              >
                <td className="px-6 py-3 text-gray-900 font-medium">
                  {seat.githubUsername}
                </td>
                <td className="px-6 py-3 text-gray-700">
                  {formatName(seat.firstName, seat.lastName)}
                </td>
                <td className="px-6 py-3 text-gray-700">
                  {seat.department ?? "—"}
                </td>
                <td className="px-6 py-3 text-right text-gray-700">
                  <span className="inline-flex items-center gap-2">
                    <UsageStatusIndicator percent={seat.usagePercent} />
                    {seat.usagePercent}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={data.page}
            totalPages={data.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
