"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { MONTH_NAMES } from "@/lib/constants";
import { formatCurrency } from "@/lib/format-helpers";

interface TopDailySpendingEntry {
  seatId: number;
  githubUsername: string;
  displayName: string;
  day: number;
  totalSpending: number;
}

interface TopSpendingsChartProps {
  data: TopDailySpendingEntry[];
  month: number;
  onBarClick?: (seatId: number) => void;
}

function SpendingTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { displayName: string; day: number; totalSpending: number };
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-sm font-medium text-gray-900">{entry.displayName}</p>
      <p className="text-sm text-gray-700">
        Day {entry.day}: {formatCurrency(entry.totalSpending)}
      </p>
    </div>
  );
}

export default function TopSpendingsChart({
  data,
  month,
  onBarClick,
}: TopSpendingsChartProps) {
  const chartData = data.map((entry) => ({
    ...entry,
    label: `${entry.displayName} — ${MONTH_NAMES[month - 1].substring(0, 3)} ${entry.day}`,
  }));

  return (
    <div role="img" aria-label="Top daily spendings chart">
      <ResponsiveContainer width="100%" height={data.length * 40 + 40}>
        <BarChart layout="vertical" data={chartData}>
          <XAxis
            type="number"
            tickFormatter={(val) => formatCurrency(val)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={200}
            tick={{ fontSize: 13 }}
          />
          <Tooltip content={<SpendingTooltip />} />
          <Bar
            dataKey="totalSpending"
            fill="#2563eb"
            cursor={onBarClick ? "pointer" : undefined}
            onClick={(barData) => {
              if (onBarClick && barData?.payload) {
                onBarClick(barData.payload.seatId);
              }
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
