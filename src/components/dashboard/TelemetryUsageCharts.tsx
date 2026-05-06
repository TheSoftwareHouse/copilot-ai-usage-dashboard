"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTelemetryUsage } from "@/lib/hooks/useTelemetryUsage";
import Pagination from "@/components/usage/Pagination";

const PAGE_SIZE = 10;

interface TelemetryUsageChartsProps {
  month: number;
  year: number;
  day?: number;
  githubUsername?: string;
  teamId?: number;
}

export default function TelemetryUsageCharts({
  month,
  year,
  day,
  githubUsername,
  teamId,
}: TelemetryUsageChartsProps) {
  const { data, loading, error } = useTelemetryUsage({
    month,
    year,
    day,
    githubUsername,
    teamId,
  });

  const [agentPage, setAgentPage] = useState<number>(1);
  const [promptPage, setPromptPage] = useState<number>(1);
  const [prevData, setPrevData] = useState(data);

  if (data !== prevData) {
    setPrevData(data);
    setAgentPage(1);
    setPromptPage(1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <p className="text-sm text-gray-500">Loading telemetry data…</p>
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

  if (
    !data ||
    (data.agentUsage.length === 0 && data.promptUsage.length === 0)
  ) {
    return null;
  }

  const totalAgentPages = Math.ceil(data.agentUsage.length / PAGE_SIZE);
  const pagedAgentUsage = data.agentUsage.slice(
    (agentPage - 1) * PAGE_SIZE,
    agentPage * PAGE_SIZE
  );
  const agentChartHeight = Math.max(200, pagedAgentUsage.length * 40);

  const totalPromptPages = Math.ceil(data.promptUsage.length / PAGE_SIZE);
  const pagedPromptUsage = data.promptUsage.slice(
    (promptPage - 1) * PAGE_SIZE,
    promptPage * PAGE_SIZE
  );
  const promptChartHeight = Math.max(200, pagedPromptUsage.length * 40);

  return (
    <div className="space-y-6">
      {data.agentUsage.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Agent Usage
          </h2>
          <div
            role="img"
            aria-label="Agent usage chart showing request counts per agent"
          >
            <ResponsiveContainer width="100%" height={agentChartHeight}>
              <BarChart layout="vertical" data={pagedAgentUsage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="agent"
                  tick={{ fontSize: 12 }}
                  width={150}
                />
                <Tooltip
                  formatter={(value: number | undefined) => [
                    (value ?? 0).toLocaleString(),
                    "Count",
                  ]}
                />
                <Bar dataKey="count" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {totalAgentPages > 1 && (
            <div className="mt-4">
              <Pagination
                currentPage={agentPage}
                totalPages={totalAgentPages}
                onPageChange={setAgentPage}
              />
            </div>
          )}
        </div>
      )}

      {data.promptUsage.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Prompt Usage
          </h2>
          <div
            role="img"
            aria-label="Prompt usage chart showing request counts per prompt"
          >
            <ResponsiveContainer width="100%" height={promptChartHeight}>
              <BarChart layout="vertical" data={pagedPromptUsage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="prompt"
                  tick={{ fontSize: 12 }}
                  width={150}
                />
                <Tooltip
                  formatter={(value: number | undefined) => [
                    (value ?? 0).toLocaleString(),
                    "Count",
                  ]}
                />
                <Bar dataKey="count" fill="#7c3aed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {totalPromptPages > 1 && (
            <div className="mt-4">
              <Pagination
                currentPage={promptPage}
                totalPages={totalPromptPages}
                onPageChange={setPromptPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
