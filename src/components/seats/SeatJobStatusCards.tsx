"use client";

import { useState, useEffect, useCallback } from "react";
import {
  JobCard,
  SyncNowButton,
  type JobExecutionData,
} from "@/components/settings/JobStatusPanel";

interface SeatJobStatusData {
  seatSync: JobExecutionData | null;
}

function serializeExecution(
  raw: Record<string, unknown> | null,
): JobExecutionData | null {
  if (!raw) return null;
  return {
    status: raw.status as string,
    reason: raw.reason ? String(raw.reason) : null,
    startedAt: String(raw.startedAt),
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : null,
    recordsProcessed:
      raw.recordsProcessed != null ? Number(raw.recordsProcessed) : null,
  };
}

export default function SeatJobStatusCards() {
  const [data, setData] = useState<SeatJobStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await fetch("/api/job-status");

      if (response.status === 401) {
        setError("Session expired. Please log in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load seat sync status (${response.status})`);
      }

      const json = await response.json();
      setData({
        seatSync: serializeExecution(json.seatSync),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load seat sync status",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobStatus();
  }, [fetchJobStatus]);

  if (isLoading) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Seat sync status loading"
      >
        <div className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
        <div className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-md border border-red-200 bg-red-50 p-4"
        role="alert"
      >
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const handleActionComplete = () => fetchJobStatus(true);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <JobCard
        title="Seat Sync"
        execution={data.seatSync}
        action={<SyncNowButton onComplete={handleActionComplete} />}
      />
    </div>
  );
}
