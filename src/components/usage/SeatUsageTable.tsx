"use client";

import Link from "next/link";
import { calcUsagePercent } from "@/lib/usage-helpers";
import { UsageStatusIndicator } from "@/components/usage/UsageStatusIndicator";
import DeviationIcon from "@/components/shared/DeviationIcon";
import { formatCurrency, formatName } from "@/lib/format-helpers";
import SortableTableHeader from "@/components/shared/SortableTableHeader";
import type { SeatUsageEntry } from "@/components/usage/SeatUsagePanel";

interface SeatUsageTableProps {
  seats: SeatUsageEntry[];
  month: number;
  year: number;
  premiumRequestsPerSeat: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (field: string) => void;
}

export default function SeatUsageTable({ seats, month, year, premiumRequestsPerSeat, sortBy, sortOrder, onSort }: SeatUsageTableProps) {
  const isSortable = sortBy !== undefined && sortOrder !== undefined && onSort !== undefined;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {isSortable ? (
              <SortableTableHeader label="GitHub Username" field="githubUsername" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} />
            ) : (
              <th className="px-6 py-3 font-medium text-gray-500">GitHub Username</th>
            )}
            <th className="px-6 py-3 font-medium text-gray-500">Name</th>
            {isSortable ? (
              <SortableTableHeader label="Department" field="department" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} />
            ) : (
              <th className="px-6 py-3 font-medium text-gray-500">Department</th>
            )}
            <th className="px-6 py-3 text-right font-medium text-gray-500">Usage</th>
            {isSortable ? (
              <SortableTableHeader label="Total Requests" field="totalRequests" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} align="right" />
            ) : (
              <th className="px-6 py-3 text-right font-medium text-gray-500">Total Requests</th>
            )}
            {isSortable ? (
              <SortableTableHeader label="Total Spending" field="totalGrossAmount" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} align="right" />
            ) : (
              <th className="px-6 py-3 text-right font-medium text-gray-500">Total Spending</th>
            )}
          </tr>
        </thead>
        <tbody>
          {seats.map((seat) => {
            const rawPercent = calcUsagePercent(seat.totalRequests, premiumRequestsPerSeat);

            return (
            <tr
              key={seat.seatId}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
            >
              <td className="px-6 py-3 text-gray-900 font-medium">
                <Link
                  href={`/usage/seats/${seat.seatId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  <span className="inline-flex items-center gap-2">
                    <UsageStatusIndicator percent={rawPercent} />
                    {seat.deviationLevel !== "none" && seat.normValue !== null && (
                      <DeviationIcon
                        level={seat.deviationLevel}
                        tooltipText={`${seat.deviationLevel === "alert" ? "Alert" : "Warning"}: ${seat.peakMultiplier?.toFixed(1)}x norm on Day ${seat.peakDay}`}
                      />
                    )}
                    {seat.githubUsername}
                  </span>
                </Link>
              </td>
              <td className="px-6 py-3 text-gray-700">
                <Link
                  href={`/usage/seats/${seat.seatId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {formatName(seat.firstName, seat.lastName)}
                </Link>
              </td>
              <td className="px-6 py-3 text-gray-700">
                <Link
                  href={`/usage/seats/${seat.seatId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {seat.department ?? "—"}
                </Link>
              </td>
              <td className="px-6 py-3 text-right text-gray-700">
                <Link
                  href={`/usage/seats/${seat.seatId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {seat.totalRequests.toLocaleString()} / {premiumRequestsPerSeat} ({Math.round(rawPercent)}%)
                </Link>
              </td>
              <td className="px-6 py-3 text-right text-gray-700">
                <Link
                  href={`/usage/seats/${seat.seatId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {seat.totalRequests.toLocaleString()}
                </Link>
              </td>
              <td className="px-6 py-3 text-right text-gray-700">
                <Link
                  href={`/usage/seats/${seat.seatId}?month=${month}&year=${year}`}
                  className="block w-full"
                >
                  {formatCurrency(seat.totalGrossAmount)}
                </Link>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
