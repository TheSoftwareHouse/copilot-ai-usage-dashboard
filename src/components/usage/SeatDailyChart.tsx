"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DEVIATION_COLORS } from "@/components/shared/DeviationIcon";

interface DailyUsageEntry {
  day: number;
  totalRequests: number;
  grossAmount: number;
  deviation?: { level: "none" | "warning" | "alert"; multiplier: number };
}

interface SeatDailyChartProps {
  dailyUsage: DailyUsageEntry[];
  daysInMonth: number;
  normValue?: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltipContent({ active, payload, label, normValue }: any) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload;
  const totalRequests = data?.totalRequests ?? 0;
  const deviation = data?.deviation;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-gray-900">Day {label}</p>
      <p className="text-sm text-gray-600">
        Total Requests: {totalRequests.toLocaleString()}
      </p>
      {normValue && deviation && deviation.level !== "none" && (
        <p className="text-sm font-medium" style={{ color: DEVIATION_COLORS[deviation.level as "warning" | "alert"].fill }}>
          {DEVIATION_COLORS[deviation.level as "warning" | "alert"].text}: {deviation.multiplier.toFixed(1)}x norm
        </p>
      )}
    </div>
  );
}

export default function SeatDailyChart({
  dailyUsage,
  daysInMonth,
  normValue,
}: SeatDailyChartProps) {
  const usageByDay = new Map(dailyUsage.map((d) => [d.day, d]));

  const chartData = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const entry = usageByDay.get(day);
    return {
      day,
      totalRequests: entry?.totalRequests ?? 0,
      deviation: entry?.deviation,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderDeviationLabel(props: any) {
    const { x, y, width, value } = props;
    const entry = chartData[props.index];
    const deviation = entry?.deviation;

    if (!normValue || !deviation || deviation.level === "none" || value === 0) {
      return null;
    }

    const colors = DEVIATION_COLORS[deviation.level];
    const cx = x + width / 2;
    const cy = y - 12;
    const tooltipText = `${colors.text}: ${deviation.multiplier.toFixed(1)}x norm (${Math.round(normValue)} requests/day)`;

    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill={colors.fill} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={10} fontWeight="bold">!</text>
        <title>{tooltipText}</title>
      </g>
    );
  }

  return (
    <div role="img" aria-label="Daily usage bar chart showing total requests per day with deviation indicators">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 25, right: 5, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltipContent normValue={normValue} />} />
          <Bar dataKey="totalRequests" fill="#2563eb" label={renderDeviationLabel} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
