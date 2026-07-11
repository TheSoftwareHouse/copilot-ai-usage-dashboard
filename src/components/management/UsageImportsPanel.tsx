"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MONTH_NAMES } from "@/lib/constants";
import { formatTimestamp } from "@/lib/format-helpers";
import { JobCard, type JobExecutionData } from "@/components/settings/JobStatusPanel";

const MAX_CSV_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const HISTORY_LIMIT = 10;

interface ImportHistoryMonth {
  month: number;
  year: number;
}

interface ImportHistoryRecord {
  id: number;
  filename: string;
  executedAt: string;
  recordsProcessed: number;
  matchedUserCount: number;
  skippedUserCount: number;
  skippedUsernames: string[];
  affectedMonths: ImportHistoryMonth[];
  overwrittenSeatDayCount: number;
}

interface ImportResult {
  importHistoryId: number;
  recordsProcessed: number;
  matchedUserCount: number;
  skippedUserCount: number;
  skippedUsernames: string[];
  affectedMonths: ImportHistoryMonth[];
  overwrittenSeatDayCount: number;
  overwriteWarnings: string[];
  refreshWarnings: string[];
}

interface HistoryResponse {
  imports: ImportHistoryRecord[];
}

interface JobStatusResponse {
  retiredJobs: {
    usageCollection: JobExecutionData | null;
    monthRecollection: JobExecutionData | null;
  };
}

function formatMonthYear(month: number, year: number): string {
  const monthName = MONTH_NAMES[month - 1];
  return monthName ? `${monthName} ${year}` : `${month}/${year}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} bytes`;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

function StatusBanner({
  type,
  title,
  children,
}: {
  type: "success" | "warning";
  title: string;
  children: React.ReactNode;
}) {
  const bannerClasses =
    type === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div role="status" className={`rounded-lg border p-4 ${bannerClasses}`}>
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

function HistoryCard({ record }: { record: ImportHistoryRecord }) {
  const affectedMonths = record.affectedMonths
    .map(({ month, year }) => formatMonthYear(month, year))
    .join(", ");

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">{record.filename}</h4>
          <p className="text-xs text-gray-500">Imported {formatTimestamp(record.executedAt)}</p>
        </div>
        <div className="text-xs font-medium text-gray-500">Import #{record.id}</div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Records processed
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{record.recordsProcessed}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Users matched
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{record.matchedUserCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Users skipped
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{record.skippedUserCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Overwritten seat/day rows
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{record.overwrittenSeatDayCount}</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3 text-sm text-gray-700">
        <div>
          <span className="font-medium text-gray-900">Affected periods:</span>{" "}
          {affectedMonths || "No affected months recorded"}
        </div>

        <div>
          <span className="font-medium text-gray-900">Skipped usernames:</span>{" "}
          {record.skippedUsernames.length > 0 ? record.skippedUsernames.join(", ") : "None"}
        </div>
      </div>
    </article>
  );
}

export default function UsageImportsPanel() {
  const [history, setHistory] = useState<ImportHistoryRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeSeatsCount, setActiveSeatsCount] = useState<number | null>(null);
  const [seatCountError, setSeatCountError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<ImportResult | null>(null);
  const [usageCollectionExecution, setUsageCollectionExecution] =
    useState<JobExecutionData | null>(null);
  const [isJobStatusLoading, setIsJobStatusLoading] = useState(true);
  const [jobStatusError, setJobStatusError] = useState<string | null>(null);
  const [usageCollectionActionError, setUsageCollectionActionError] = useState<string | null>(null);
  const [usageCollectionActionMessage, setUsageCollectionActionMessage] =
    useState<string | null>(null);
  const [runningUsageCollection, setRunningUsageCollection] = useState(false);
  const [runningMonthRebuild, setRunningMonthRebuild] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/usage/imports?limit=${HISTORY_LIMIT}`);

      if (response.status === 401) {
        setHistoryError("Session expired. Please log in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load import history (${response.status})`);
      }

      const data = (await response.json()) as HistoryResponse;
      setHistory(data.imports ?? []);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "Failed to load import history.",
      );
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const loadJobStatus = useCallback(async () => {
    setIsJobStatusLoading(true);
    setJobStatusError(null);

    try {
      const response = await fetch("/api/job-status");

      if (response.status === 401) {
        setJobStatusError("Session expired. Please log in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load usage collection status (${response.status})`);
      }

      const data = (await response.json()) as JobStatusResponse;
      setUsageCollectionExecution(data.retiredJobs.usageCollection);
    } catch (error) {
      setJobStatusError(
        error instanceof Error ? error.message : "Failed to load usage collection status.",
      );
    } finally {
      setIsJobStatusLoading(false);
    }
  }, []);

  async function runUsageCollectionAction(
    endpoint: string,
    successMessage: string,
    setRunning: (running: boolean) => void,
  ) {
    setRunning(true);
    setUsageCollectionActionError(null);
    setUsageCollectionActionMessage(null);

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (response.status === 401) {
        setUsageCollectionActionError("Session expired. Please log in again.");
        return;
      }

      if (!response.ok) {
        setUsageCollectionActionError(payload?.error ?? "Usage collection action failed.");
        await loadJobStatus();
        return;
      }

      const recordsProcessed = payload?.recordsProcessed;
      if (typeof recordsProcessed === "number") {
        setUsageCollectionActionMessage(
          `${successMessage} (${recordsProcessed} seat/day row${recordsProcessed === 1 ? "" : "s"} updated).`,
        );
      } else {
        setUsageCollectionActionMessage(successMessage);
      }
      await loadJobStatus();
    } catch {
      setUsageCollectionActionError("Network error. Please check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  async function handleRunTodaysUsageCollection() {
    await runUsageCollectionAction(
      "/api/jobs/usage-collection",
      "Today's usage collection completed.",
      setRunningUsageCollection,
    );
  }

  async function handleRebuildCurrentMonthToDate() {
    await runUsageCollectionAction(
      "/api/jobs/month-recollection",
      "Current month-to-date usage rebuild completed.",
      setRunningMonthRebuild,
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSeatCount() {
      try {
        const response = await fetch("/api/seats?status=active&page=1&pageSize=1");

        if (response.status === 401) {
          if (!cancelled) {
            setSeatCountError("Session expired. Please log in again.");
          }
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load active seat count (${response.status})`);
        }

        const data = await response.json();
        if (!cancelled) {
          setActiveSeatsCount(Number(data.total ?? 0));
        }
      } catch (error) {
        if (!cancelled) {
          setSeatCountError(
            error instanceof Error ? error.message : "Failed to load active seat count.",
          );
        }
      }
    }

    loadHistory();
    loadSeatCount();
    void loadJobStatus();

    return () => {
      cancelled = true;
    };
  }, [loadHistory, loadJobStatus]);

  function clearSelectedFile() {
    setSelectedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    setUploadResult(null);

    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      setFileError(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setFileError("Please select a .csv file.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
      setSelectedFile(null);
      setFileError(
        `Files must be ${formatFileSize(MAX_CSV_FILE_SIZE_BYTES)} or smaller.`,
      );
      event.target.value = "";
      return;
    }

    setSelectedFile(file);
    setFileError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile || fileError) {
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.set("file", selectedFile);

      const response = await fetch("/api/usage/imports", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setUploadError(payload?.error ?? "CSV import failed. Please try again.");
        return;
      }

      const result: ImportResult = {
        importHistoryId: payload.importHistoryId,
        recordsProcessed: payload.recordsProcessed,
        matchedUserCount: payload.matchedUserCount,
        skippedUserCount: payload.skippedUserCount,
        skippedUsernames: payload.skippedUsernames ?? [],
        affectedMonths: payload.affectedMonths ?? [],
        overwrittenSeatDayCount: payload.overwrittenSeatDayCount,
        overwriteWarnings: payload.overwriteWarnings ?? [],
        refreshWarnings: payload.refreshWarnings ?? [],
      };

      setUploadResult(result);
      clearSelectedFile();
      await loadHistory();
    } catch {
      setUploadError("Network error. Please check your connection and try again.");
    } finally {
      setIsUploading(false);
    }
  }

  const isUploadDisabled = !selectedFile || Boolean(fileError) || isUploading;
  const hasSeatWarning = activeSeatsCount === 0 && !seatCountError;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">CSV import</h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload a GitHub billing export for AIC credits. GitHub API data remains authoritative
            for overlapping seat/day rows.
          </p>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p>
            Accepted files must use the .csv extension and be {formatFileSize(MAX_CSV_FILE_SIZE_BYTES)} or smaller.
          </p>
        </div>

        {activeSeatsCount === null && !seatCountError && (
          <div
            role="status"
            className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600"
          >
            Checking active seat count...
          </div>
        )}

        {hasSeatWarning && (
          <StatusBanner type="warning" title="No active seats found">
            Username matching will fail until seat sync runs and seats exist in the system.
          </StatusBanner>
        )}

        {seatCountError && <ErrorBanner message={seatCountError} />}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="usage-import-file"
              className="block text-sm font-medium text-gray-700"
            >
              CSV file
            </label>
            <input
              ref={fileInputRef}
              id="usage-import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              aria-describedby="usage-import-help usage-import-file-error"
              className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p id="usage-import-help" className="mt-2 text-xs text-gray-500">
              Select a CSV export from GitHub billing. If GitHub API data already exists for the
              same seat/day, those rows stay in place and the import will report skipped overlaps.
            </p>
            <p id="usage-import-file-error" className="mt-2 text-sm text-red-700">
              {fileError ?? "\u00A0"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isUploadDisabled}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? "Uploading..." : "Upload CSV"}
            </button>
            {selectedFile && !fileError && (
              <span className="text-sm text-gray-600">
                {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </span>
            )}
          </div>
        </form>

        {uploadError && <ErrorBanner message={uploadError} />}

        {uploadResult && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <StatusBanner
              type={uploadResult.refreshWarnings.length > 0 ? "warning" : "success"}
              title="Latest import completed"
            >
              Import #{uploadResult.importHistoryId} processed {uploadResult.recordsProcessed} record
              {uploadResult.recordsProcessed === 1 ? "" : "s"}, matched {uploadResult.matchedUserCount} user
              {uploadResult.matchedUserCount === 1 ? "" : "s"}, and skipped {uploadResult.skippedUserCount} user
              {uploadResult.skippedUserCount === 1 ? "" : "s"}.
            </StatusBanner>

            {uploadResult.overwriteWarnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Overwrite rule</p>
                <p className="mt-2">
                  GitHub API data takes precedence over CSV for the same seat/day. Overlapping CSV
                  rows were skipped and reported in this import.
                </p>
              </div>
            )}

            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Records processed
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{uploadResult.recordsProcessed}</dd>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Users matched
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{uploadResult.matchedUserCount}</dd>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Users skipped
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{uploadResult.skippedUserCount}</dd>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Overwritten seat/day rows
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{uploadResult.overwrittenSeatDayCount}</dd>
              </div>
            </dl>

            <div className="space-y-2 text-sm text-gray-700">
              <p>
                <span className="font-medium text-gray-900">Affected periods:</span>{" "}
                {uploadResult.affectedMonths.length > 0
                  ? uploadResult.affectedMonths
                      .map(({ month, year }) => formatMonthYear(month, year))
                      .join(", ")
                  : "No affected periods recorded"}
              </p>

              <p>
                <span className="font-medium text-gray-900">Skipped usernames:</span>{" "}
                {uploadResult.skippedUsernames.length > 0
                  ? uploadResult.skippedUsernames.join(", ")
                  : "None"}
              </p>
            </div>

            {uploadResult.refreshWarnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Refresh warnings</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {uploadResult.refreshWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Usage Collection</h2>
          <p className="mt-1 text-sm text-gray-600">
            Trigger GitHub API usage collection for today or rebuild the current month to date.
            CSV import above remains available for AIC data uploads.
          </p>
        </div>

        {isJobStatusLoading ? (
          <div
            role="status"
            className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600"
          >
            Loading usage collection status...
          </div>
        ) : jobStatusError ? (
          <ErrorBanner message={jobStatusError} />
        ) : (
          <JobCard title="Last automated collection" execution={usageCollectionExecution} />
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleRunTodaysUsageCollection}
            disabled={runningUsageCollection || runningMonthRebuild}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runningUsageCollection ? "Running today's usage collection..." : "Run today's usage collection"}
          </button>
          <button
            type="button"
            onClick={handleRebuildCurrentMonthToDate}
            disabled={runningUsageCollection || runningMonthRebuild}
            className="inline-flex items-center rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runningMonthRebuild ? "Rebuilding current month to date..." : "Rebuild current month to date"}
          </button>
        </div>

        {usageCollectionActionError && <ErrorBanner message={usageCollectionActionError} />}
        {usageCollectionActionMessage && (
          <StatusBanner type="success" title="Usage collection completed">
            {usageCollectionActionMessage}
          </StatusBanner>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Import history</h2>
          <p className="mt-1 text-sm text-gray-600">Newest imports appear first.</p>
        </div>

        {isHistoryLoading ? (
          <div
            role="status"
            className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600"
          >
            Loading import history...
          </div>
        ) : historyError ? (
          <ErrorBanner message={historyError} />
        ) : history.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
            No imports have been recorded yet.
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((record) => (
              <HistoryCard key={record.id} record={record} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
