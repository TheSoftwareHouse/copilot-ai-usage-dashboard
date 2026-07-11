"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SeatDailyChart from "@/components/usage/SeatDailyChart";
import { MONTH_NAMES } from "@/lib/constants";

interface DailyUsageEntry {
  day: number;
  totalRequests: number;
}

interface SeatInfo {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
}

interface SeatModelDailyDetailResponse {
  seat: SeatInfo;
  model: string;
  month: number;
  year: number;
  dailyUsage: DailyUsageEntry[];
}

interface SeatModelDailyDetailPanelProps {
  seatId: number;
  modelName: string;
  initialMonth: number;
  initialYear: number;
}

export default function SeatModelDailyDetailPanel({
  seatId,
  modelName,
  initialMonth,
  initialYear,
}: SeatModelDailyDetailPanelProps) {
  const [data, setData] = useState<SeatModelDailyDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/usage/seats/${seatId}/models/${encodeURIComponent(modelName)}?month=${initialMonth}&year=${initialYear}`,
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Seat not found");
          }
          throw new Error(
            `Failed to load seat model usage data (${response.status})`,
          );
        }

        const json: SeatModelDailyDetailResponse = await response.json();
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
  }, [seatId, modelName, initialMonth, initialYear]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <p className="text-sm text-gray-500">Loading seat model daily usage…</p>
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

  const monthLabel = `${MONTH_NAMES[data.month - 1]} ${data.year}`;
  const daysInMonth = new Date(data.year, data.month, 0).getDate();
  const heading = `Daily AIC Units for ${data.model} by ${data.seat.githubUsername} (${monthLabel})`;

  return (
    <div className="space-y-6">
      <Link
        href={`/usage/seats/${data.seat.seatId}?month=${data.month}&year=${data.year}`}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        ← Back to {data.seat.githubUsername}
      </Link>

      <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>

      {data.dailyUsage.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            No AIC CSV data for this model and time period.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <SeatDailyChart
            dailyUsage={data.dailyUsage}
            daysInMonth={daysInMonth}
            metricLabel="AIC Units"
          />
        </div>
      )}
    </div>
  );
}
