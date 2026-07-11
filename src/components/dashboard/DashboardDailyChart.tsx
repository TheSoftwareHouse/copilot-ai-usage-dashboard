"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { MONTH_NAMES } from "@/lib/constants";

interface DashboardDailyChartProps {
  dailyUsage: Array<{ day: number; totalRequests: number }>;
  previousDailyUsage: Array<{ day: number; totalRequests: number }>;
  daysInMonth: number;
  month: number;
  year: number;
  metricLabel: string;
  onBarClick?: (day: number, month: number, year: number) => void;
}

interface ComparisonTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string; name: string }>;
  label?: number;
  currentMonthLabel: string;
  previousMonthLabel: string;
}

function ComparisonTooltip({
  active,
  payload,
  label,
  currentMonthLabel,
  previousMonthLabel,
}: ComparisonTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const currentEntry = payload.find((p) => p.dataKey === "totalRequests");
  const previousEntry = payload.find((p) => p.dataKey === "previousTotalRequests");

  const currentValue = currentEntry?.value ?? 0;
  const previousValue = previousEntry?.value;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="mb-1 text-sm font-medium text-gray-900">Day {label}</p>
      <p className="text-sm text-gray-700">
        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#2563eb]" />
        {currentMonthLabel}: {currentValue.toLocaleString()}
      </p>
      {previousValue !== undefined && (
        <>
          <p className="text-sm text-gray-700">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#93c5fd]" />
            {previousMonthLabel}: {previousValue.toLocaleString()}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-500">
            Difference: {(currentValue - previousValue) > 0 ? "+" : ""}
            {(currentValue - previousValue).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

export default function DashboardDailyChart({
  dailyUsage,
  previousDailyUsage,
  daysInMonth,
  month,
  year,
  metricLabel,
  onBarClick,
}: DashboardDailyChartProps) {
  const usageByDay = new Map(dailyUsage.map((d) => [d.day, d]));
  const previousUsageByDay = new Map(previousDailyUsage.map((d) => [d.day, d]));

  const hasPreviousData = previousDailyUsage.length > 0;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const previousDaysInMonth = new Date(prevYear, prevMonth, 0).getDate();

  const chartData = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const entry = usageByDay.get(day);
    const previousEntry = previousUsageByDay.get(day);
    return {
      day,
      totalRequests: entry?.totalRequests ?? 0,
      previousTotalRequests:
        hasPreviousData && day <= previousDaysInMonth
          ? (previousEntry?.totalRequests ?? 0)
          : undefined,
    };
  });

  const currentMonthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const previousMonthLabel = `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`;

  return (
    <div
      role="img"
      aria-label={
        hasPreviousData
          ? `Daily ${metricLabel.toLowerCase()} bar chart comparing current and previous month`
          : `Daily ${metricLabel.toLowerCase()} bar chart showing total requests per day`
      }
    >
      <ResponsiveContainer width="100%" height={300}>
        {hasPreviousData ? (
          <BarChart data={chartData} barGap={-24}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              content={
                <ComparisonTooltip
                  currentMonthLabel={currentMonthLabel}
                  previousMonthLabel={previousMonthLabel}
                />
              }
            />
            <Legend
              content={() => (
                <ul className="flex justify-center gap-4 pt-2">
                  <li className="flex items-center gap-1.5 text-sm text-gray-700">
                    <span className="inline-block h-3 w-3 rounded-sm bg-[#2563eb]" />
                    {currentMonthLabel}
                  </li>
                  <li className="flex items-center gap-1.5 text-sm text-gray-700">
                    <span className="inline-block h-3 w-3 rounded-sm bg-[#93c5fd]" />
                    {previousMonthLabel}
                  </li>
                </ul>
              )}
            />
            <Bar
              dataKey="previousTotalRequests"
              fill="#93c5fd"
              barSize={24}
              name={previousMonthLabel}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={(_data: unknown, index: number) => {
                if (onBarClick && chartData[index]) {
                  onBarClick(chartData[index].day, prevMonth, prevYear);
                }
              }}
            />
            <Bar
              dataKey="totalRequests"
              fill="#2563eb"
              barSize={14}
              name={currentMonthLabel}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={(_data: unknown, index: number) => {
                if (onBarClick && chartData[index]) {
                  onBarClick(chartData[index].day, month, year);
                }
              }}
            />
          </BarChart>
        ) : (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value: number | undefined) => [
                (value ?? 0).toLocaleString(),
                metricLabel,
              ]}
              labelFormatter={(label) => `Day ${label}`}
            />
            <Bar
              dataKey="totalRequests"
              fill="#2563eb"
              cursor={onBarClick ? "pointer" : undefined}
              onClick={(_data: unknown, index: number) => {
                if (onBarClick && chartData[index]) {
                  onBarClick(chartData[index].day, month, year);
                }
              }}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
