"use client";

import { useState, useEffect } from "react";
import ConfigurationForm from "@/components/setup/ConfigurationForm";
import GitHubConnectionCard from "@/components/management/GitHubConnectionCard";

interface ConfigurationData {
  apiMode: string;
  entityName: string;
  premiumRequestsPerSeat?: number;
  telemetryApiKey?: string | null;
  normSeatsCount?: number;
  deviationWarningThreshold?: number;
  deviationAlertThreshold?: number;
}

export default function ConfigurationTabContent() {
  const [config, setConfig] = useState<ConfigurationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchConfiguration() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/configuration");

        if (response.status === 401) {
          if (!cancelled) {
            setError("Session expired. Please log in again.");
          }
          return;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to load configuration (${response.status})`,
          );
        }

        const data = await response.json();
        if (!cancelled) {
          setConfig(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load configuration",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchConfiguration();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-gray-500" role="status">
        Loading configuration…
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

  if (!config) {
    return null;
  }

  return (
    <div className="space-y-6">
      <GitHubConnectionCard />
      <ConfigurationForm
        mode="edit"
        initialValues={{
          premiumRequestsPerSeat: config.premiumRequestsPerSeat,
          telemetryApiKey: config.telemetryApiKey,
          normSeatsCount: config.normSeatsCount,
          deviationWarningThreshold: config.deviationWarningThreshold,
          deviationAlertThreshold: config.deviationAlertThreshold,
        }}
      />
    </div>
  );
}
