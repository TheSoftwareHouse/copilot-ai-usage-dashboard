"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface SeatOption {
  id: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
}

interface AddMembersFormProps {
  teamId: number;
  month: number;
  year: number;
  existingMemberSeatIds: number[];
  onMembersAdded: (allocationWarnings: { seatId: number; totalAllocationPercentage: number }[]) => void;
}

function formatSeatName(firstName: string | null, lastName: string | null): string {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "";
}

export default function AddMembersForm({
  teamId,
  month,
  year,
  existingMemberSeatIds,
  onMembersAdded,
}: AddMembersFormProps) {
  const [availableSeats, setAvailableSeats] = useState<SeatOption[]>([]);
  const [isLoadingSeats, setIsLoadingSeats] = useState(true);
  const [seatFetchError, setSeatFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [allocationPercentage, setAllocationPercentage] = useState<string>("100");
  const [allocationWarnings, setAllocationWarnings] = useState<{ seatId: number; totalAllocationPercentage: number }[]>([]);

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

      const existingSet = new Set(existingMemberSeatIds);
      setAvailableSeats(allSeats.filter((s) => !existingSet.has(s.id)));
    } catch {
      setSeatFetchError("Failed to load available seats. Please try again.");
    } finally {
      setIsLoadingSeats(false);
    }
  }, [existingMemberSeatIds]);

  useEffect(() => {
    fetchSeats();
  }, [fetchSeats]);

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

  function toggleSeat(seatId: number) {
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

  async function handleSubmit() {
    if (selectedSeatIds.size === 0) return;
    setSubmitError(null);
    setAllocationWarnings([]);
    setIsSubmitting(true);
    try {
      const parsedAllocation = allocationPercentage.trim() === "" ? undefined : Number(allocationPercentage);
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatIds: [...selectedSeatIds],
          month,
          year,
          allocationPercentage: parsedAllocation,
        }),
      });
      if (response.status === 201) {
        const data = await response.json();
        setAllocationWarnings(data.allocationWarnings ?? []);
        onMembersAdded(data.allocationWarnings ?? []);
        return;
      }
      const data = await response.json().catch(() => null);
      setSubmitError(data?.error ?? "Failed to add members. Please try again.");
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Add Members</h3>
      <p className="mb-3 text-xs text-gray-500">
        Adding members to {month}/{year}. Leave allocation empty to default to 100%.
      </p>

      {isLoadingSeats && (
        <p className="text-sm text-gray-500">Loading available seats…</p>
      )}

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

      {!isLoadingSeats && !seatFetchError && availableSeats.length === 0 && (
        <p className="text-sm text-gray-500">
          All active seats are already assigned to this team.
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

          <div className="mb-3">
            <label htmlFor="allocation-percentage" className="block text-xs font-medium text-gray-700 mb-1">
              Cost allocation % (optional, applies to the whole batch)
            </label>
            <input
              id="allocation-percentage"
              type="number"
              min={1}
              max={100}
              value={allocationPercentage}
              onChange={(e) => setAllocationPercentage(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            disabled={selectedSeatIds.size === 0 || isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Adding…" : `Add Selected (${selectedSeatIds.size})`}
          </button>

          {allocationWarnings.length > 0 && (
            <div role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {allocationWarnings.map((warning) => (
                <p key={warning.seatId}>
                  Seat #{warning.seatId} is now allocated at {warning.totalAllocationPercentage}% across teams for this month.
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
