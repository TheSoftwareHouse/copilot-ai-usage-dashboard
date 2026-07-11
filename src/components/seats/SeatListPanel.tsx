"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import DeviationIcon from "@/components/shared/DeviationIcon";
import EditableTextCell from "@/components/shared/EditableTextCell";
import EditableDepartmentCell from "@/components/seats/EditableDepartmentCell";
import { formatRelativeTime, formatTimestamp } from "@/lib/format-helpers";

interface SeatRecord {
  id: number;
  githubUsername: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  departmentId: number | null;
  lastActivityAt: string | null;
  createdAt: string;
  totalAiCredits?: number;
  deviationLevel?: "none" | "warning" | "alert";
  peakMultiplier?: number | null;
  peakDay?: number | null;
}

interface SeatsResponse {
  seats: SeatRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface DepartmentOption {
  id: number;
  name: string;
}

type SortField =
  | "githubUsername"
  | "status"
  | "firstName"
  | "lastName"
  | "department"
  | "lastActivityAt";

const SORTABLE_COLUMNS: { field: SortField; label: string }[] = [
  { field: "githubUsername", label: "GitHub Username" },
  { field: "status", label: "Status" },
  { field: "firstName", label: "First Name" },
  { field: "lastName", label: "Last Name" },
  { field: "department", label: "Department" },
  { field: "lastActivityAt", label: "Last Active" },
];

const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [100, 200, 300];

const SEAT_STATUS_CONFIG: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  active: {
    label: "Active",
    bgClass: "bg-green-100",
    textClass: "text-green-800",
  },
  inactive: {
    label: "Inactive",
    bgClass: "bg-gray-100",
    textClass: "text-gray-800",
  },
};

function SeatStatusBadge({ status }: { status: string }) {
  const config = SEAT_STATUS_CONFIG[status] ?? {
    label: status,
    bgClass: "bg-gray-100",
    textClass: "text-gray-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bgClass} ${config.textClass}`}
      aria-label={`Status: ${config.label}`}
    >
      {config.label}
    </span>
  );
}

export default function SeatListPanel() {
  const [data, setData] = useState<SeatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filter / sort / page size state
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("githubUsername");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Department options for dropdown
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  // Debounce search input → search (300 ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch departments for the edit dropdown
  useEffect(() => {
    async function loadDepartments() {
      try {
        const res = await fetch("/api/departments");
        if (res.ok) {
          const json = await res.json();
          setDepartments(
            (json.departments as { id: number; name: string }[]).map((d) => ({
              id: d.id,
              name: d.name,
            }))
          );
        }
      } catch {
        // Graceful degradation — dropdown will be empty
      }
    }
    loadDepartments();
  }, []);

  const fetchSeats = useCallback(
    async (
      requestedPage: number,
      reqPageSize: number,
      reqSearch: string,
      reqStatus: string,
      reqSortBy: string,
      reqSortOrder: string
    ) => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams({
          page: String(requestedPage),
          pageSize: String(reqPageSize),
          sortBy: reqSortBy,
          sortOrder: reqSortOrder,
        });
        if (reqSearch) params.set("search", reqSearch);
        if (reqStatus) params.set("status", reqStatus);

        const response = await fetch(`/api/seats?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch seats");
        }
        const json: SeatsResponse = await response.json();
        setData(json);
      } catch {
        setFetchError("Failed to load seats. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchSeats(page, pageSize, search, statusFilter, sortBy, sortOrder);
  }, [fetchSeats, page, pageSize, search, statusFilter, sortBy, sortOrder]);

  function handleSortClick(field: SortField) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
    setPage(1);
  }

  function handleStatusChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function handlePageSizeChange(value: number) {
    setPageSize(value);
    setPage(1);
  }

  const updateSeatField = useCallback(
    async (
      seatId: number,
      payload: { firstName?: string | null; lastName?: string | null; departmentId?: number | null }
    ): Promise<void> => {
      const response = await fetch(`/api/seats/${seatId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Failed to save");
      }

      const updated = await response.json();

      // Patch the local seats array to avoid full reload
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          seats: prev.seats.map((s) =>
            s.id === seatId
              ? {
                  ...s,
                  firstName: updated.firstName ?? null,
                  lastName: updated.lastName ?? null,
                  department: updated.department ?? null,
                  departmentId: updated.departmentId ?? null,
                }
              : s
          ),
        };
      });
    },
    []
  );

  if (isLoading && !data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-500">Loading seats…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-sm text-red-700">{fetchError}</p>
        <button
          type="button"
          onClick={() => fetchSeats(page, pageSize, search, statusFilter, sortBy, sortOrder)}
          className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (data && data.total === 0 && !search && !statusFilter) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">No seats synced</h3>
        <p className="mt-2 text-sm text-gray-500">
          No seats have been synced yet. Seats will appear here after the first
          sync completes. You can trigger a sync from the Settings page.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const startIndex = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const endIndex = Math.min(data.page * data.pageSize, data.total);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="seat-search" className="sr-only">
            Search seats
          </label>
          <input
            id="seat-search"
            type="search"
            placeholder="Search…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="seat-status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="seat-status-filter"
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label htmlFor="seat-page-size" className="sr-only">
            Items per page
          </label>
          <select
            id="seat-page-size"
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200" aria-label="Copilot seats">
          <thead className="bg-gray-50">
            <tr>
              {SORTABLE_COLUMNS.map(({ field, label }) => (
                <th
                  key={field}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  <button
                    type="button"
                    onClick={() => handleSortClick(field)}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                    aria-label={`Sort by ${label}`}
                  >
                    {label}
                    {sortBy === field ? (
                      <span aria-hidden="true">
                        {sortOrder === "asc" ? "▲" : "▼"}
                      </span>
                    ) : (
                      <span aria-hidden="true" className="text-gray-300">
                        ⇅
                      </span>
                    )}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                AIC Units
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.seats.map((seat) => {
              const isActive = seat.status !== "inactive";
              const showDeviation =
                isActive &&
                seat.deviationLevel !== undefined &&
                seat.deviationLevel !== "none";
              return (
              <tr key={seat.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {showDeviation ? (
                        <span className="inline-flex items-center gap-2">
                          <DeviationIcon
                            level={seat.deviationLevel as "warning" | "alert"}
                            tooltipText={`${seat.deviationLevel === "alert" ? "Alert" : "Warning"}: ${Math.round(seat.peakMultiplier ?? 0).toLocaleString()} AIC Units on Day ${seat.peakDay}`}
                          />
                          <Link
                            href={`/usage/seats/${seat.id}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {seat.githubUsername}
                          </Link>
                        </span>
                      ) : (
                        <Link
                          href={`/usage/seats/${seat.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {seat.githubUsername}
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <SeatStatusBadge status={seat.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <EditableTextCell
                        value={seat.firstName}
                        onSave={(v) => updateSeatField(seat.id, { firstName: v })}
                        ariaLabel={`Edit first name for ${seat.githubUsername}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <EditableTextCell
                        value={seat.lastName}
                        onSave={(v) => updateSeatField(seat.id, { lastName: v })}
                        ariaLabel={`Edit last name for ${seat.githubUsername}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <EditableDepartmentCell
                        departmentId={seat.departmentId}
                        departmentName={seat.department}
                        departments={departments}
                        onSave={(deptId) => updateSeatField(seat.id, { departmentId: deptId })}
                        ariaLabel={`Edit department for ${seat.githubUsername}`}
                      />
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3 text-sm text-gray-700"
                      title={seat.lastActivityAt ? formatTimestamp(seat.lastActivityAt) : undefined}
                    >
                      {seat.lastActivityAt
                        ? formatRelativeTime(seat.lastActivityAt)
                        : "Never"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-700">
                      {seat.totalAiCredits != null
                        ? seat.totalAiCredits.toLocaleString()
                        : "N/A"}
                    </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-gray-700">
          Showing {startIndex}–{endIndex} of {data.total} seat{data.total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={data.page <= 1}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-700">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={data.page >= data.totalPages}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
