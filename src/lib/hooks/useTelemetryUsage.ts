"use client";

import { useState, useEffect } from "react";

export interface TelemetryUsageData {
  agentUsage: { agent: string; count: number }[];
  promptUsage: { prompt: string; count: number }[];
}

interface UseTelemetryUsageOptions {
  month: number;
  year: number;
  day?: number;
  githubUsername?: string;
  teamId?: number;
}

interface UseTelemetryUsageResult {
  data: TelemetryUsageData | null;
  loading: boolean;
  error: string | null;
}

export function useTelemetryUsage(options: UseTelemetryUsageOptions): UseTelemetryUsageResult {
  const [data, setData] = useState<TelemetryUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { month, year, day, githubUsername, teamId } = options;

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        let url = `/api/telemetry/usage?month=${month}&year=${year}`;
        if (day !== undefined) url += `&day=${day}`;
        if (githubUsername) url += `&github_username=${encodeURIComponent(githubUsername)}`;
        if (teamId !== undefined) url += `&team_id=${teamId}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load telemetry data (${response.status})`);
        const json: TelemetryUsageData = await response.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "An unexpected error occurred");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [month, year, day, githubUsername, teamId]);

  return { data, loading, error };
}
