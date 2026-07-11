"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/shared/Modal";

interface ConnectionData {
  appName: string;
  appSlug: string;
  htmlUrl: string;
  entityName: string;
  apiMode: string;
  connectionDate: string;
  connectionStatus: string;
  statusMessage?: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; dotClass: string; alertClass: string }
> = {
  active: {
    label: "Active",
    dotClass: "bg-green-500",
    alertClass: "",
  },
  suspended: {
    label: "Suspended",
    dotClass: "bg-yellow-500",
    alertClass: "border-yellow-200 bg-yellow-50 text-yellow-800",
  },
  revoked: {
    label: "Revoked",
    dotClass: "bg-red-500",
    alertClass: "border-red-200 bg-red-50 text-red-800",
  },
  not_installed: {
    label: "Not Installed",
    dotClass: "bg-gray-400",
    alertClass: "border-gray-200 bg-gray-50 text-gray-800",
  },
  unknown: {
    label: "Unknown",
    dotClass: "bg-gray-400",
    alertClass: "border-gray-200 bg-gray-50 text-gray-700",
  },
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function GitHubConnectionCard() {
  const [data, setData] = useState<ConnectionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    seats: number;
    usageRecords: number;
    teams: number;
    departments: number;
    monthlySummaries: number;
  } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/github-app/status");

        if (response.status === 401) {
          if (!cancelled) {
            setError("Session expired. Please log in again.");
          }
          return;
        }

        if (response.status === 404) {
          if (!cancelled) {
            setIsLoading(false);
          }
          return;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to load connection details (${response.status})`,
          );
        }

        const json = await response.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load connection details",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showDisconnectModal) {
      setPreviewData(null);
      setPreviewError(false);
      return;
    }

    let cancelled = false;

    async function fetchPreview() {
      setIsPreviewLoading(true);
      setPreviewError(false);

      try {
        const response = await fetch("/api/github-app/disconnect-preview");
        if (!response.ok) throw new Error("Failed to load preview");
        const json = await response.json();
        if (!cancelled) setPreviewData(json);
      } catch {
        if (!cancelled) setPreviewError(true);
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    }

    fetchPreview();

    return () => { cancelled = true; };
  }, [showDisconnectModal]);

  if (isLoading) {
    return (
      <div className="py-4 text-center text-sm text-gray-500" role="status">
        Loading connection details…
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

  const statusCfg = STATUS_CONFIG[data.connectionStatus] ?? STATUS_CONFIG.unknown;
  const entityLabel = data.apiMode === "enterprise" ? "Enterprise" : "Organisation";

  async function handleDisconnect() {
    setIsDisconnecting(true);
    setDisconnectError(null);

    try {
      const response = await fetch("/api/github-app/disconnect", {
        method: "POST",
      });

      if (response.status === 401) {
        setDisconnectError("Session expired. Please log in again.");
        return;
      }

      if (!response.ok) {
        const json = await response.json();
        setDisconnectError(json.error || `Failed to disconnect ${entityLabel.toLowerCase()}.`);
        return;
      }

      const json = await response.json();
      const redirectUrl = json.githubUninstalled === false
        ? "/setup?reconnect=true&githubUninstallFailed=true"
        : "/setup?reconnect=true";
      window.location.href = redirectUrl;
    } catch {
      setDisconnectError("Network error. Please check your connection and try again.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-base font-semibold text-gray-900">
        GitHub {entityLabel} Connection
      </h3>

      <dl className="space-y-3 text-sm">
        <div className="flex">
          <dt className="w-32 shrink-0 text-gray-500">{entityLabel}</dt>
          <dd className="font-medium text-gray-900">{data.entityName}</dd>
        </div>
        <div className="flex">
          <dt className="w-32 shrink-0 text-gray-500">Type</dt>
          <dd className="text-gray-900">{capitalise(data.apiMode)}</dd>
        </div>
        <div className="flex">
          <dt className="w-32 shrink-0 text-gray-500">Connected</dt>
          <dd className="text-gray-900">{formatDate(data.connectionDate)}</dd>
        </div>
        <div className="flex">
          <dt className="w-32 shrink-0 text-gray-500">Status</dt>
          <dd className="flex items-center gap-2 text-gray-900">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${statusCfg.dotClass}`}
              aria-hidden="true"
            />
            {statusCfg.label}
          </dd>
        </div>
      </dl>

      {data.statusMessage && (
        <div
          className={`mt-4 rounded-md border p-3 text-sm ${statusCfg.alertClass}`}
          role="alert"
        >
          {data.statusMessage}
        </div>
      )}

      <div className="mt-4">
        <a
          href={data.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          View GitHub App on GitHub ↗
        </a>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => { setShowDisconnectModal(true); setIsPreviewLoading(true); setDisconnectError(null); }}
          className="text-sm font-medium text-red-600 hover:text-red-800"
        >
          Disconnect {entityLabel}
        </button>
      </div>

      <Modal
        isOpen={showDisconnectModal}
        onClose={() => { if (!isDisconnecting) setShowDisconnectModal(false); }}
        title={`Disconnect ${entityLabel}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to disconnect <strong>{data.entityName}</strong> from the dashboard?
          </p>

          {isPreviewLoading && (
            <p className="text-sm text-gray-500">Loading data summary…</p>
          )}

          {!isPreviewLoading && previewData && (
            previewData.seats === 0 &&
            previewData.usageRecords === 0 &&
            previewData.teams === 0 &&
            previewData.departments === 0 &&
            previewData.monthlySummaries === 0 ? (
              <p className="text-sm text-gray-700">
                No data has been collected yet.
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Your existing data will be preserved:
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-600 space-y-1">
                  {previewData.seats > 0 && (
                    <li>{previewData.seats.toLocaleString()} Copilot seats</li>
                  )}
                  {previewData.usageRecords > 0 && (
                    <li>{previewData.usageRecords.toLocaleString()} usage records</li>
                  )}
                  {previewData.teams > 0 && (
                    <li>{previewData.teams.toLocaleString()} teams (including member history)</li>
                  )}
                  {previewData.departments > 0 && (
                    <li>{previewData.departments.toLocaleString()} departments</li>
                  )}
                  {previewData.monthlySummaries > 0 && (
                    <li>{previewData.monthlySummaries.toLocaleString()} monthly summaries</li>
                  )}
                </ul>
              </div>
            )
          )}

          {!isPreviewLoading && previewError && (
            <p className="text-sm text-gray-700">
              Existing data will be preserved and remain accessible.
            </p>
          )}

          <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
            <li>The GitHub App will be uninstalled from <strong>{data.entityName}</strong>.</li>
            <li>GitHub data sync will stop immediately.</li>
            <li>If you connect a different {entityLabel.toLowerCase()}, new data will be collected alongside the existing data.</li>
            <li>You will need to install the GitHub App on an {entityLabel.toLowerCase()} again to resume data collection.</li>
          </ul>

          {disconnectError && (
            <div
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {disconnectError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowDisconnectModal(false)}
              disabled={isDisconnecting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isPreviewLoading || isDisconnecting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDisconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
