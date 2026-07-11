"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MONTH_NAMES } from "@/lib/constants";

interface SeatOption {
  id: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
}

interface BackfillHistoryFormProps {
  teamId: number;
  onMembersBackfilled: () => void;
}

function formatSeatName(firstName: string | null, lastName: string | null): string {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "";
}

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

function generateYearOptions(): number[] {
  const years: number[] = [];
  for (let y = 2020; y <= currentYear; y++) {
    years.push(y);
  }
  return years;
}

const yearOptions = generateYearOptions();

export default function BackfillHistoryForm({
  teamId,
  onMembersBackfilled,
}: BackfillHistoryFormProps) {
  // Date range state
  const [startMonth, setStartMonth] = useState(currentMonth);
  const [startYear, setStartYear] = useState(currentYear);
  const [endMonth, setEndMonth] = useState(currentMonth);
  const [endYear, setEndYear] = useState(currentYear);

  // Seat state
  const [availableSeats, setAvailableSeats] = useState<SeatOption[]>([]);
  const [isLoadingSeats, setIsLoadingSeats] = useState(true);
  const [seatFetchError, setSeatFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<number>>(new Set());

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Client-side date validation
  const isStartAfterEnd = useMemo(() => {
    return startYear * 12 + startMonth > endYear * 12 + endMonth;
  }, [startMonth, startYear, endMonth, endYear]);

  const isFutureEnd = useMemo(() => {
    return endYear * 12 + endMonth > currentYear * 12 + currentMonth;
  }, [endMonth, endYear]);

  const hasDateError = isStartAfterEnd || isFutureEnd;

  // Fetch all active seats on mount
  const fetchSeats = useCallback(async () => {
    setIsLoadingSeats(true);
    setSeatFetchError(null);
    try {
      // Fetch all active seats by paginating through all pages
      const allSeats: SeatOption[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const response = await fetch(
          `/api/seats?status=active&page=${page}&pageSize=100`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch seats");
        }
        const data = await response.json();
        totalPages = data.totalPages;
        allSeats.push(
          ...data.seats.map(
            (s: {
              id: number;
              githubUsername: string;
              firstName: string | null;
              lastName: string | null;
            }) => ({
              id: s.id,
              githubUsername: s.githubUsername,
              firstName: s.firstName,
              lastName: s.lastName,
            }),
          ),
        );
        page++;
      } while (page <= totalPages);

      setAvailableSeats(allSeats);
    } catch {
      setSeatFetchError("Failed to load available seats. Please try again.");
    } finally {
      setIsLoadingSeats(false);
    }
  }, []);

  useEffect(() => {
    fetchSeats();
  }, [fetchSeats]);

  // Search filtering
  const filteredSeats = useMemo(() => {
    if (!searchQuery.trim()) return availableSeats;
    const query = searchQuery.toLowerCase();
    return availableSeats.filter(
      (seat) =>
        seat.githubUsername.toLowerCase().includes(query) ||
        (seat.firstName && seat.firstName.toLowerCase().includes(query)) ||
        (seat.lastName && seat.lastName.toLowerCase().includes(query)),
    );
  }, [availableSeats, searchQuery]);

  // Clear stale success message when date inputs change
  useEffect(() => {
    setSuccessMessage(null);
  }, [startMonth, startYear, endMonth, endYear]);

  function toggleSeat(seatId: number) {
    setSuccessMessage(null);
    setSelectedSeatIds((prev) => {
      const next = new Set(prev);
      if (next.has(seatId)) {
        next.delete(seatId);
      } else {
        next.add(seatId);
      }
      return next;
    });
  }

  function handleDateChange(setter: (val: number) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter(Number(e.target.value));
    };
  }

  async function handleSubmit() {
    if (selectedSeatIds.size === 0 || hasDateError) return;
    setSubmitError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/members/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatIds: [...selectedSeatIds],
          startMonth,
          startYear,
          endMonth,
          endYear,
        }),
      });
      if (response.status === 201) {
        const data = await response.json();
        const { added, totalMonthsInRange } = data;
        const snapshotWord = added === 1 ? "snapshot" : "snapshots";
        const monthWord = totalMonthsInRange === 1 ? "month" : "months";
        setSuccessMessage(
          `Added ${added} ${snapshotWord} across ${totalMonthsInRange} ${monthWord}`,
        );
        setSelectedSeatIds(new Set());
        setSearchQuery("");
        onMembersBackfilled();
        return;
      }
      const data = await response.json().catch(() => null);
      setSubmitError(data?.error ?? "Failed to backfill members. Please try again.");
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled =
    selectedSeatIds.size === 0 || isSubmitting || hasDateError;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Backfill History</h3>
      <p className="mb-3 text-xs text-gray-500">
        Backfilled rows use the default 100% allocation in Epic 1.
      </p>

      {/* Date range selectors */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label htmlFor="backfill-start-month" className="block text-xs font-medium text-gray-700 mb-1">
            Start Month
          </label>
          <select
            id="backfill-start-month"
            value={startMonth}
            onChange={handleDateChange(setStartMonth)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="backfill-start-year" className="block text-xs font-medium text-gray-700 mb-1">
            Start Year
          </label>
          <select
            id="backfill-start-year"
            value={startYear}
            onChange={handleDateChange(setStartYear)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="backfill-end-month" className="block text-xs font-medium text-gray-700 mb-1">
            End Month
          </label>
          <select
            id="backfill-end-month"
            value={endMonth}
            onChange={handleDateChange(setEndMonth)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="backfill-end-year" className="block text-xs font-medium text-gray-700 mb-1">
            End Year
          </label>
          <select
            id="backfill-end-year"
            value={endYear}
            onChange={handleDateChange(setEndYear)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Date validation messages */}
      {isStartAfterEnd && (
        <p role="alert" className="text-sm text-red-600 mb-3">
          Start date must be before or equal to end date
        </p>
      )}
      {isFutureEnd && (
        <p role="alert" className="text-sm text-red-600 mb-3">
          End date cannot be in the future
        </p>
      )}

      {/* Seat loading state */}
      {isLoadingSeats && (
        <p className="text-sm text-gray-500">Loading available seats…</p>
      )}

      {/* Seat fetch error */}
      {seatFetchError && (
        <div className="space-y-3">
          <div
            role="alert"
            className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200"
          >
            {seatFetchError}
          </div>
          <button
            type="button"
            onClick={fetchSeats}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Seat list */}
      {!isLoadingSeats && !seatFetchError && availableSeats.length === 0 && (
        <p className="text-sm text-gray-500">
          No active seats available.
        </p>
      )}

      {!isLoadingSeats && !seatFetchError && availableSeats.length > 0 && (
        <>
          <div className="mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search seats…"
              aria-label="Search available seats"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="max-h-48 overflow-y-auto mb-3 space-y-1">
            {filteredSeats.map((seat) => {
              const name = formatSeatName(seat.firstName, seat.lastName);
              return (
                <label
                  key={seat.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-100 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSeatIds.has(seat.id)}
                    onChange={() => toggleSeat(seat.id)}
                    aria-label={`Select ${seat.githubUsername}`}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-900">{seat.githubUsername}</span>
                  {name && (
                    <span className="text-sm text-gray-500">({name})</span>
                  )}
                </label>
              );
            })}
            {filteredSeats.length === 0 && (
              <p className="text-sm text-gray-500 px-2 py-1.5">
                No seats match your search.
              </p>
            )}
          </div>

          {/* Success message */}
          {successMessage && (
            <div
              role="alert"
              className="rounded-md bg-green-50 p-4 text-sm text-green-700 border border-green-200 mb-3"
            >
              {successMessage}
            </div>
          )}

          {/* Submit error */}
          {submitError && (
            <div
              role="alert"
              className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200 mb-3"
            >
              {submitError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Backfilling…" : `Backfill Selected (${selectedSeatIds.size})`}
          </button>
        </>
      )}
    </div>
  );
}
