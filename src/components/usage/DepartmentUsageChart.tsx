"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";

export interface DepartmentUsageChartEntry {
  departmentId: number;
  departmentName: string;
  usagePercent: number;
}

interface DepartmentUsageChartProps {
  departments: DepartmentUsageChartEntry[];
  onBarClick?: (departmentId: number) => void;
}

function getUsageBarColor(percent: number): string {
  if (percent >= 90) return "#22c55e";
  if (percent >= 50) return "#f97316";
  return "#ef4444";
}

export default function DepartmentUsageChart({
  departments,
  onBarClick,
}: DepartmentUsageChartProps) {
  // Sort highest → lowest so the horizontal bar chart renders highest usage at the top
  const sortedDepartments = [...departments].sort(
    (a, b) => b.usagePercent - a.usagePercent,
  );

  const chartHeight = Math.max(200, sortedDepartments.length * 40);

  return (
    <div
      role="img"
      aria-label="Department usage chart showing each department's usage percentage"
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart layout="vertical" data={sortedDepartments}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fontSize: 12 }} unit="%" />
          <YAxis
            type="category"
            dataKey="departmentName"
            tick={{ fontSize: 12 }}
            width={150}
          />
          <Tooltip
            formatter={(value: number | undefined) => [
              `${Math.round(value ?? 0)}%`,
              "Usage",
            ]}
            labelFormatter={(label) => String(label)}
          />
          <ReferenceLine
            x={100}
            stroke="#6b7280"
            strokeDasharray="3 3"
            label={{ value: "100% included", position: "top", fontSize: 12 }}
          />
          <Bar
            dataKey="usagePercent"
            name="Usage %"
            cursor={onBarClick ? "pointer" : undefined}
            onClick={(_data: unknown, index: number) => {
              if (onBarClick && sortedDepartments[index]) {
                onBarClick(sortedDepartments[index].departmentId);
              }
            }}
          >
            {sortedDepartments.map((dept) => (
              <Cell key={dept.departmentId} fill={getUsageBarColor(dept.usagePercent)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
