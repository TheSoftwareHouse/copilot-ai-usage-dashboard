"use client";

import { useAsyncFetch } from "@/lib/hooks/useAsyncFetch";

interface DepartmentDetailStatsResponse {
  averageRequests: number | null;
  medianRequests: number | null;
  minRequests: number | null;
  maxRequests: number | null;
  month: number;
  year: number;
}

interface DepartmentDetailStatsCardsProps {
  departmentId: number;
  month: number;
  year: number;
}

const STAT_CARDS = [
  { key: "averageRequests" as const, label: "Average Usage" },
  { key: "medianRequests" as const, label: "Median Usage" },
  { key: "minRequests" as const, label: "Minimum Usage" },
  { key: "maxRequests" as const, label: "Maximum Usage" },
];

export default function DepartmentDetailStatsCards({ departmentId, month, year }: DepartmentDetailStatsCardsProps) {
  const { data, loading } = useAsyncFetch<DepartmentDetailStatsResponse>(
    `/api/usage/departments/${departmentId}/stats?month=${month}&year=${year}`,
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>
      {STAT_CARDS.map(({ key, label }) => {
        const value = data?.[key];
        const display = !loading && value != null ? `${Math.round(value)}%` : "—";

        return (
          <div
            key={key}
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-sm font-medium text-gray-500">{label}</h2>
            <p className="mt-2 text-3xl font-bold text-gray-900">{display}</p>
          </div>
        );
      })}
    </div>
  );
}
