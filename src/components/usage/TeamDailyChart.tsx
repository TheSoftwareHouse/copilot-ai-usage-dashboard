"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface MemberDailyUsage {
  seatId: number;
  githubUsername: string;
  days: { day: number; totalRequests: number }[];
}

interface TeamDailyChartProps {
  dailyUsagePerMember: MemberDailyUsage[];
  daysInMonth: number;
  metricLabel?: string;
  accessibleLabel?: string;
}

const LINE_COLOURS = [
  "#2563eb", // blue-600
  "#dc2626", // red-600
  "#16a34a", // green-600
  "#9333ea", // purple-600
  "#ea580c", // orange-600
  "#0891b2", // cyan-600
  "#ca8a04", // yellow-600
  "#db2777", // pink-600
  "#4f46e5", // indigo-600
  "#059669", // emerald-600
];

export default function TeamDailyChart({
  dailyUsagePerMember,
  daysInMonth,
  metricLabel = "Total Requests",
  accessibleLabel,
}: TeamDailyChartProps) {
  // Build a map per member: day -> totalRequests
  const memberMaps = dailyUsagePerMember.map((member) => {
    const dayMap = new Map(member.days.map((d) => [d.day, d.totalRequests]));
    return { githubUsername: member.githubUsername, dayMap };
  });

  // Build chart data: one object per day with a key per member
  const chartData = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const point: Record<string, number> = { day };
    for (const member of memberMaps) {
      point[member.githubUsername] = member.dayMap.get(day) ?? 0;
    }
    return point;
  });

  const chartAccessibleLabel =
    accessibleLabel ??
    `Daily usage line chart showing ${metricLabel.toLowerCase()} per day for each team member`;

  return (
    <div role="img" aria-label={chartAccessibleLabel}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            labelFormatter={(label) => `Day ${label}`}
            formatter={(value: number | string | undefined) => [
              Number(value ?? 0).toLocaleString(),
              metricLabel,
            ]}
          />
          <Legend />
          {dailyUsagePerMember.map((member, index) => (
            <Line
              key={member.seatId}
              type="monotone"
              dataKey={member.githubUsername}
              stroke={LINE_COLOURS[index % LINE_COLOURS.length]}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
