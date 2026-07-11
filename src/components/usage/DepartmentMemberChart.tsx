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

interface MemberChartEntry {
  seatId: number;
  githubUsername: string;
  totalRequests: number;
}

interface DepartmentMemberChartProps {
  members: MemberChartEntry[];
  onBarClick?: (seatId: number) => void;
}

export default function DepartmentMemberChart({
  members,
  onBarClick,
}: DepartmentMemberChartProps) {
  // Sort highest → lowest so the horizontal bar chart renders highest usage at the top
  const sortedMembers = [...members].sort(
    (a, b) => b.totalRequests - a.totalRequests,
  );

  const chartHeight = Math.max(200, sortedMembers.length * 40);

  return (
    <div
      role="img"
      aria-label="Department member usage chart showing each member's total AIC Units"
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart layout="vertical" data={sortedMembers}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis
            type="category"
            dataKey="githubUsername"
            tick={{ fontSize: 12 }}
            width={150}
          />
          <Tooltip
            formatter={(value: number | undefined) => [
              (value ?? 0).toLocaleString(),
              "AIC Units",
            ]}
            labelFormatter={(label) => String(label)}
          />
          <Bar
            dataKey="totalRequests"
            name="AIC Units"
            fill="#3b82f6"
            cursor={onBarClick ? "pointer" : undefined}
            onClick={(_data: unknown, index: number) => {
              if (onBarClick && sortedMembers[index]) {
                onBarClick(sortedMembers[index].seatId);
              }
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
